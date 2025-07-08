const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');

const { performLogin, scrapeAllProducts } = require('./helpers/scraper');
const { synchronizeDatabase } = require('./helpers/database');

async function obaobaSync(email, password, userId) {
  let browser = null;
  try {
    console.log('Iniciando navegador...');
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    console.log('Recebida requisição para iniciar a sincronização...');
    
    await performLogin(page, email, password, process.env.CAPTCHA_API_KEY);
    
    await page.goto('https://app.obaobamix.com.br/admin/products', { waitUntil: 'networkidle' });
    
    const scrapedProducts = await scrapeAllProducts(page);
    
    if (scrapedProducts.length > 0) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      await synchronizeDatabase(supabase, userId, scrapedProducts);
    }
    
    console.log('Processo finalizado com sucesso!');
    return { message: 'Sincronização completa!', totalProdutos: scrapedProducts.length };

  } catch (error) {
    console.error('Ocorreu um erro fatal no robô:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
    console.log('Navegador fechado.');
  }
}

module.exports = obaobaSync;
