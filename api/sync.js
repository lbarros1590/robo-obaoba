const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

async function obaobaSync(email, password, userId) {
  let browser = null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { CAPTCHA_API_KEY } = process.env;

    console.log('Iniciando navegador...');
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    const page = await context.newPage();
    
    console.log('Realizando login...');
    await performLogin(page, email, password, CAPTCHA_API_KEY);
    
    console.log('Acessando a página de produtos...');
    await page.goto('https://app.obaobamix.com.br/admin/products');
    
    console.log('Extraindo todos os produtos...');
    const todosOsProdutosExtraidos = await scrapeAllProducts(page);
    
    console.log(`Extração concluída. Total de ${todosOsProdutosExtraidos.length} produtos encontrados.`);
    
    if (todosOsProdutosExtraidos.length > 0) {
        console.log('Iniciando sincronização com o banco de dados Supabase...');
        
        const produtosParaSalvar = todosOsProdutosExtraidos.map(p => ({ ...p, user_id: userId }));

        // Usamos a nova 'variant_id' como a chave para o upsert
        const { error: upsertError } = await supabase
            .from('products')
            .upsert(produtosParaSalvar, { onConflict: 'variant_id' }); 

        if (upsertError) {
            throw new Error(`Erro ao salvar produtos no Supabase: ${upsertError.message}`);
        }
        console.log(`${produtosParaSalvar.length} produtos foram salvos ou atualizados no banco.`);

        const receivedVariantIds = todosOsProdutosExtraidos.map(p => `'${p.variant_id}'`);
        const { error: deactivateError } = await supabase
            .from('products')
            .update({ is_active: false })
            .eq('user_id', userId)
            .not('variant_id', 'in', `(${receivedVariantIds.join(',')})`);
        
        if (deactivateError) console.error('Erro ao desativar produtos antigos:', deactivateError.message);
        else console.log('Produtos antigos foram desativados com sucesso.');
    }
    
    console.log('Sincronização com o banco de dados concluída!');
    return { message: 'Sincronização completa realizada com sucesso!', totalProdutos: todosOsProdutosExtraidos.length };

  } catch (error) {
    console.error('Ocorreu um erro fatal durante a execução do robô:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Navegador fechado.');
    }
  }
}

// --- Funções Auxiliares ---

async function performLogin(page, email, password, captchaKey) {
    // ... (código do login continua igual)
    await page.goto('https://app.obaobamix.com.br/login', { waitUntil: 'networkidle' });
    const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
    const captchaToken = await resolveCaptcha(siteKey, page.url(), captchaKey);
    await page.evaluate(token => { document.getElementById('g-recaptcha-response').value = token; }, captchaToken);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/admin', { timeout: 60000 });
    console.log('Login bem-sucedido.');
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
                
                // **** LÓGICA PARA CRIAR O ID ÚNICO DA VARIAÇÃO ****
                // Ex: "OOM-123-cabo-15-metros"
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
    // ... (código do captcha continua igual)
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
