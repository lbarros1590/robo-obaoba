const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

async function obaobaSync(email, password, userId) {
  let browser = null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { CAPTCHA_API_KEY } = process.env;
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const page = (await browser.newContext()).newPage();
    await performLogin(page, email, password, CAPTCHA_API_KEY);
    await page.goto('https://app.obaobamix.com.br/admin/products');
    const produtosExtraidos = await scrapeAllProducts(page);
    if (produtosExtraidos.length > 0) {
      console.log('Iniciando sincronização com o banco de dados...');
      const produtosParaSalvar = produtosExtraidos.map(p => ({ ...p, user_id: userId, purchase_price: p.purchase_price }));
      const { error: upsertError } = await supabase.from('products').upsert(produtosParaSalvar, { onConflict: 'variant_id' });
      if (upsertError) throw new Error(`Erro ao salvar produtos: ${upsertError.message}`);
      const receivedVariantIds = produtosExtraidos.map(p => `'${p.variant_id}'`);
      await supabase.from('products').update({ is_active: false }).eq('user_id', userId).not('variant_id', 'in', `(${receivedVariantIds.join(',')})`);
      console.log('Sincronização com banco de dados concluída.');
    }
    return { message: 'Sincronização completa!', totalProdutos: produtosExtraidos.length };
  } catch (error) {
    console.error('Erro fatal no robô:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

// ... (COLE AQUI AS FUNÇÕES AUXILIARES COMPLETAS: performLogin, scrapeAllProducts, resolveCaptcha) ...
// É crucial que as funções auxiliares que já te passei estejam aqui.

module.exports = obaobaSync;
