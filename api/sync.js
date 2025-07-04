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
      const receivedVariantIds = produtosParaSalvar.map(p => `'${p.variant_id}'`);
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

async function performLogin(page, email, password, captchaKey) {
  await page.goto('https://app.obaobamix.com.br/login', { waitUntil: 'networkidle' });
  const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
  const captchaToken = await resolveCaptcha(siteKey, page.url(), captchaKey);
  await page.evaluate(token => { document.getElementById('g-recaptcha-response').value = token; }, captchaToken);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/admin', { timeout: 60000 });
}

async function scrapeAllProducts(page) {
  const seletorTabela = 'table.datatable-Product tbody tr';
  await page.waitForSelector(seletorTabela, { timeout: 60000 });
  let todosOsProdutos = [];
  let paginaAtual = 1;
  while (true) {
    console.log(`Extraindo dados da página ${paginaAtual}...`);
    const produtosDaPagina = await page.$$eval(seletorTabela, rows =>
      rows.map(row => {
        const columns = row.querySelectorAll('td');
        if (columns.length < 7) return null;
        const sku = columns[0]?.innerText.trim();
        const title = columns[2]?.innerText.trim();
        const stock = parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0;
        const purchase_price = parseFloat(columns[5]?.innerText.trim().replace('R$', '').replace(',', '.')) || 0;
        const variant_id = `${sku}-${title.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;
        return { sku, title, stock, purchase_price, variant_id, is_active: true };
      }).filter(p => p && p.sku)
    );
    todosOsProdutos.push(...produtosDaPagina);
    const proximoBotao = page.locator('li.next:not(.disabled) a');
    if (await proximoBotao.count() > 0) {
      await proximoBotao.click();
      await page.waitForTimeout(2500);
      paginaAtual++;
    } else {
      break;
    }
  }
  return todosOsProdutos;
}

async function resolveCaptcha(siteKey, pageUrl, apiKey) {
  const res = await axios.post(`http://2captcha.com/in.php`, null, { params: { key: apiKey, method: 'userrecaptcha', googlekey: siteKey, pageurl: pageUrl, json: 1 } });
  const requestId = res.data.request;
  if (res.data.status !== 1) throw new Error(`Erro ao enviar CAPTCHA: ${res.data.request}`);
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const check = await axios.get(`http://2captcha.com/res.php`, { params: { key: apiKey, action: 'get', id: requestId, json: 1 } });
    if (check.data.status === 1) return check.data.request;
  }
}

module.exports = obaobaSync;
