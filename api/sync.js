const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');

// Importa as funções dos nossos arquivos de helpers
const { performLoginAndGetCookies, scrapeProducts } = require('./helpers/scraper');
const { saveSessionCookies, getSessionCookies, syncProductsWithDatabase } = require('./helpers/database');

async function obaobaSync(action, email, password, userId) {
  let browser = null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log(`Recebida ação: "${action}"`);
    
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (action === 'login_and_save_session') {
      const cookies = await performLoginAndGetCookies(page, email, password, process.env.CAPTCHA_API_KEY);
      await saveSessionCookies(supabase, userId, cookies);
      return { success: true, message: 'Conexão estabelecida e sessão salva!' };

    } else if (action === 'sync_products') {
      const cookies = await getSessionCookies(supabase, userId);
      if (!cookies) {
        throw new Error('Sessão não encontrada. Por favor, conecte-se primeiro.');
      }

      await context.addCookies(cookies);
      console.log('Cookies de sessão carregados no navegador.');

      await page.goto('https://app.obaobamix.com.br/admin/products');
      
      if (page.url().includes('/login')) {
        throw new Error('Sessão expirada. Por favor, conecte-se novamente para renovar a sessão.');
      }
      console.log('Acesso direto à página de produtos bem-sucedido.');

      const products = await scrapeProducts(page);
      await syncProductsWithDatabase(supabase, userId, products);
      
      return { success: true, message: 'Sincronização concluída com sucesso!' };

    } else {
      throw new Error(`Ação desconhecida: ${action}`);
    }

  } catch (error) {
    console.error('Ocorreu um erro fatal no robô:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = obaobaSync;
