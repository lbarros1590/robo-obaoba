const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');

// Função para resolver o reCAPTCHA v2 usando a API do 2Captcha
async function resolverCaptcha(siteKey, pageUrl, apiKey) {
  console.log('Enviando CAPTCHA para resolução...');
  const res = await axios.post(`http://2captcha.com/in.php`, null, {
    params: { key: apiKey, method: 'userrecaptcha', googlekey: siteKey, pageurl: pageUrl, json: 1 },
  });
  const requestId = res.data.request;
  if (res.data.status !== 1) throw new Error(`Erro ao enviar CAPTCHA para 2Captcha: ${res.data.request}`);
  console.log(`ID da requisição do CAPTCHA: ${requestId}`);

  let result;
  // Fica verificando a cada 5 segundos se o CAPTCHA já foi resolvido
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

// Função principal que será executada pela Vercel
module.exports = async (req, res) => {
  let browser = null;
  try {
    const { OBAOBA_EMAIL, OBAOBA_SENHA, CAPTCHA_API_KEY } = process.env;

    // Lançamento do navegador em ambiente de servidor (serverless)
    console.log('Iniciando navegador headless...');
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(process.env.AWS_LAMBDA_FUNCTION_NAME ? 'https://github.com/Sparticuz/chromium/releases/download/v119.0.0/chromium-v119.0.0-pack.tar' : undefined), // <-- AQUI ESTÁ A MUDANÇA
      headless: true,
    });
    
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' });
    const page = await context.newPage();
    const loginUrl = 'https://app.obaobamix.com.br/login';

    console.log(`Navegando para a página de login: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle' });

    // Resolvendo o CAPTCHA
    const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
    const captchaToken = await resolverCaptcha(siteKey, loginUrl, CAPTCHA_API_KEY);
    await page.evaluate(token => { document.getElementById('g-recaptcha-response').value = token; }, captchaToken);
    
    // Preenchendo credenciais e fazendo login
    console.log('Preenchendo credenciais de login...');
    await page.locator('#email').fill(OBAOBA_EMAIL);
    await page.locator('#password').fill(OBAOBA_SENHA);
    
    console.log('Realizando o clique de login...');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/painel', { timeout: 30000 });
    console.log('Login realizado com sucesso! Navegando para a lista de produtos...');

    // Navegar para a página de produtos (ajuste a URL se for diferente)
    await page.goto('https://app.obaobamix.com.br/admin/products');

    // Aguardar a tabela ser carregada dinamicamente
    const seletorTabela = 'table.datatable-Product tbody tr';
    await page.waitForSelector(seletorTabela, { timeout: 60000 });
    console.log('Tabela de produtos carregada. Extraindo dados...');

    // Extrair os dados da tabela
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
    
    // Retorna os dados em formato JSON
    res.status(200).json({
        message: 'Produtos extraídos com sucesso!',
        totalProdutos: produtos.length,
        produtos: produtos,
    });

  } catch (error) {
    console.error('Ocorreu um erro durante a execução do robô:', error);
    res.status(500).json({ message: 'Falha na execução do robô.', error: error.message });
  } finally {
    if (browser) {
      await browser.close();
      console.log('Navegador fechado.');
    }
  }
};
