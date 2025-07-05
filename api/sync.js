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
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    console.log('Realizando login...');
    await performLogin(page, email, password, CAPTCHA_API_KEY); // Função com o detetive

    console.log('Login e redirecionamento bem-sucedidos. Acessando página de produtos...');
    await page.goto('https://app.obaobamix.com.br/admin/products');

    const todosOsProdutosExtraidos = await scrapeAllProducts(page);
    console.log(`Extração concluída. Total de ${todosOsProdutosExtraidos.length} produtos encontrados.`);

    if (todosOsProdutosExtraidos.length > 0) {
        console.log('Iniciando sincronização com o banco de dados Supabase...');
        const produtosParaSalvar = todosOsProdutosExtraidos.map(p => ({ ...p, user_id: userId }));

        const { error: upsertError } = await supabase.from('products').upsert(produtosParaSalvar, { onConflict: 'variant_id' }); 
        if (upsertError) throw new Error(`Erro ao salvar produtos no Supabase: ${upsertError.message}`);
        console.log(`${produtosParaSalvar.length} produtos foram salvos ou atualizados no banco.`);

        const receivedVariantIds = todosOsProdutosExtraidos.map(p => `'${p.variant_id}'`);
        await supabase.from('products').update({ is_active: false }).eq('user_id', userId).not('variant_id', 'in', `(${receivedVariantIds.join(',')})`);
        console.log('Produtos antigos foram desativados com sucesso.');
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

// --- FUNÇÃO ATUALIZADA COM O "DETETIVE" ---
async function performLogin(page, email, password, captchaKey) {
    await page.goto('https://app.obaobamix.com.br/login', { waitUntil: 'networkidle' });
    const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
    const captchaToken = await resolveCaptcha(siteKey, page.url(), captchaKey);
    await page.evaluate(token => { document.getElementById('g-recaptcha-response').value = token; }, captchaToken);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    console.log('Credenciais preenchidas. Clicando no botão de login...');
    await page.locator('button[type="submit"]').click();

    try {
        console.log("Aguardando redirecionamento para a página '/admin'...");
        await page.waitForURL('**/admin', { timeout: 30000 }); // Tempo de espera um pouco menor para teste
        console.log('Redirecionamento para /admin bem-sucedido.');
    } catch (e) {
        if (e.name === 'TimeoutError') {
            console.error("TIMEOUT! A página não redirecionou para '/admin' a tempo.");
            const currentUrl = page.url();
            console.error(`URL atual no momento do timeout: ${currentUrl}`);
            console.error("Capturando o HTML da página atual para depuração...");
            const pageContent = await page.content();
            console.error("================== CONTEÚDO HTML DA PÁGINA DE FALHA ==================");
            console.error(pageContent);
            console.error("========================================================================");
        }
        throw e; // Lança o erro original para parar o processo
    }
}

async function scrapeAllProducts(page) {
  //... (código da função continua o mesmo de antes)
}

async function resolveCaptcha(siteKey, pageUrl, apiKey) {
  //... (código da função continua o mesmo de antes)
}

module.exports = obaobaSync;
