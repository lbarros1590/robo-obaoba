const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// A função principal agora faz tudo: extrai E salva.
async function obaobaSync(email, password) {
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

    console.log('Navegando para a página de produtos...');
    await page.goto('https://app.obaobamix.com.br/admin/products');

    console.log('Extraindo todos os produtos de todas as páginas...');
    const todosOsProdutos = await scrapeAllProducts(page);

    console.log(`Extração concluída. Total de ${todosOsProdutos.length} produtos encontrados.`);

    // --- NOVA LÓGICA DE BANCO DE DADOS ---
    if (todosOsProdutos.length > 0) {
        console.log('Iniciando sincronização com o banco de dados Supabase...');

        // Passo 1: Upsert (inserir ou atualizar) todos os produtos
        const { error: upsertError } = await supabase
            .from('products')
            .upsert(todosOsProdutos, { onConflict: 'sku' }); // Assumindo que SKU é a chave única

        if (upsertError) {
            throw new Error(`Erro ao salvar produtos no Supabase: ${upsertError.message}`);
        }
        console.log(`${todosOsProdutos.length} produtos foram salvos ou atualizados no banco.`);

        // Passo 2: Desativar produtos que não vieram na lista
        const receivedSkus = todosOsProdutos.map(p => p.sku);
        const { error: deactivateError } = await supabase
            .from('products')
            .update({ is_active: false })
            .not('sku', 'in', `(${receivedSkus.join(',')})`);

        if (deactivateError) {
            console.error('Erro ao desativar produtos antigos:', deactivateError.message);
        } else {
            console.log('Produtos antigos foram desativados com sucesso.');
        }
    }

    console.log('Sincronização com o banco de dados concluída!');

    return {
        message: 'Sincronização completa realizada com sucesso!',
        totalProdutos: todosOsProdutos.length,
        produtos: todosOsProdutos,
    };

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
                return {
                    sku: columns[0]?.innerText.trim(),
                    title: columns[2]?.innerText.trim(),
                    stock: parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0,
                    purchase_price: parseFloat(columns[5]?.innerText.trim().replace('R$', '').replace(',', '.')) || 0,
                    is_active: true // Sempre ativo quando vem da extração
                };
            }).filter(p => p)
        );
        todosOsProdutos.push(...produtosDaPagina);

        const proximoBotao = page.locator('li.next:not(.disabled) a');
        if (await proximoBotao.count() > 0) {
            await proximoBotao.click();
            await page.waitForTimeout(2000); 
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
