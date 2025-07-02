const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');

async function obaobaSync() {
  let browser = null;
  let page; 
  try {
    const { OBAOBA_EMAIL, OBAOBA_SENHA, CAPTCHA_API_KEY } = process.env;

    console.log('Iniciando navegador headless...');
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    page = await context.newPage();
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

    await page.waitForURL('**/painel', { timeout: 60000 });
    console.log('Login realizado com sucesso! Navegando para a lista de produtos...');

    await page.goto('https://app.obaobamix.com.br/admin/products');

    const seletorTabela = 'table.datatable-Product tbody tr';
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

    // **** NOSSO DETETIVE ESPECIALISTA (v3) ****
    if (page && error.name === 'TimeoutError') {
      console.log("================== INICIANDO DEBUG PÓS-TIMEOUT ==================");
      try {
        // Espera 1 segundo para qualquer mensagem de erro aparecer na tela
        await page.waitForTimeout(1000);
        
        // Tenta encontrar um elemento de erro comum na página
        const errorElement = page.locator('.alert, .alert-danger, .invalid-feedback, [class*="error"], .text-danger');
        
        if (await errorElement.count() > 0) {
            const errorMessage = await errorElement.first().textContent();
            console.log("!!! MENSAGEM DE ERRO ENCONTRADA NA PÁGINA !!!");
            console.log(errorMessage.trim());
        } else {
            console.log("Nenhuma mensagem de erro padrão foi encontrada na página. Tentando capturar o HTML como plano B.");
            const pageContent = await page.content();
            console.log("Conteúdo HTML da página de falha:", pageContent);
        }
      } catch (debugError) {
          console.error("ERRO AO TENTAR DEPURAR A PÁGINA:", debugError.message);
      }
      console.log("================== FIM DO DEBUG ==================");
    }
    
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
