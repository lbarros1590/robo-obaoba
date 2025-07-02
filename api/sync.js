const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');

async function obaobaSync() {
  let browser = null;
  try {
    const { OBAOBA_EMAIL, OBAOBA_SENHA, CAPTCHA_API_KEY } = process.env;

    console.log('Iniciando navegador headless...');
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    const page = await context.newPage();
    const loginUrl = 'https://app.obaobamix.com.br/login';

    console.log(`Navegando para a página de login: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle' });

    const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
    const captchaToken = await resolverCaptcha(siteKey, loginUrl, CAPTCHA_API_KEY);
    await page.evaluate(token => { document.getElementById('g-recaptcha-response').value = token; }, captchaToken);
    
    console.log('Preenchendo credenciais de login...');
    await page.locator('#email').fill(OBAOBA_EMAIL);
    await page.locator('#password').fill(OBAOBA_SENHA);
    
    console.log('Realizando o clique de login...');
    await page.locator('button[type="submit"]').click();

    // **** CORREÇÃO PRINCIPAL ****
    // Esperamos pelo redirecionamento para /admin, que você informou ser a página correta.
    console.log('Aguardando redirecionamento para o painel de administração...');
    await page.waitForURL('**/admin', { timeout: 60000 });
    console.log('Login realizado com sucesso! Acessando a página de produtos...');

    // **** SEGUNDA CORREÇÃO ****
    // Navegamos explicitamente para a página de produtos que você indicou.
    await page.goto('https://app.obaobamix.com.br/admin/products');

    const seletorTabela = 'table.datatable-Product tbody tr';
    console.log('Aguardando a tabela de produtos carregar...');
    await page.waitForSelector(seletorTabela, { timeout: 60000 });
    console.log('Tabela de produtos carregada. Extraindo dados...');

    const produtos = await page.$$eval(seletorTabela, rows =>
      rows.map(row => {
        const columns = row.querySelectorAll('td');
        return {
          nome: columns[1]?.innerText.trim(),
          estoque: parseInt(columns[2]?.innerText.trim(), 10) || 0,
          preco: columns[3]?.innerText.trim().replace('R$', '').replace(',', '.').trim(),
        };
      })
    );
    console.log(`Extração concluída. ${produtos.length} produtos encontrados.`);
    
    return {
        message: 'Produtos extraídos com sucesso!',
        totalProdutos: produtos.length,
        produtos: produtos,
    };

  } catch (error) {
    console.error('Ocorreu um erro durante a execução do robô:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Navegador fechado.');
    }
  }
}

async function resolverCaptcha(siteKey, pageUrl, apiKey) {
    // Código do resolverCaptcha continua o mesmo
    console.log('Enviando CAPTCHA para resolução...');
    const res = await axios.post(`http://2captcha.com/in.php`, null, { params: { key: apiKey, method: 'userrecaptcha', googlekey: siteKey, pageurl: pageUrl, json: 1 } });
    const requestId = res.data.request;
    if (res.data.status !== 1) throw new Error(`Erro ao enviar CAPTCHA para 2Captcha: ${res.data.request}`);
    console.log(`ID da requisição do CAPTCHA: ${requestId}`);
    let result;
    while (!result) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Aguardando resolução do CAPTCHA...');
        const check = await axios.get(`http://2captcha.com/res.php`, { params: { key: apiKey, action: 'get', id: requestId, json: 1 } });
        if (check.data.status === 1) {
            result = check.data.request;
            console.log('CAPTCHA resolvido com sucesso!');
        }
    }
    return result;
}

module.exports = obaobaSync;
