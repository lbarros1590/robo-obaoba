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

    console.log('Aguardando redirecionamento para o painel de administração...');
    await page.waitForURL('**/admin', { timeout: 60000 });
    console.log('Login realizado com sucesso! Acessando a página de produtos...');

    await page.goto('https://app.obaobamix.com.br/admin/products');

    const seletorTabela = 'table.datatable-Product tbody tr';
    console.log('Aguardando a tabela de produtos carregar...');
    await page.waitForSelector(seletorTabela, { timeout: 60000 });
    
    // Lógica de Paginação com Limite
    let todosOsProdutos = [];
    let paginaAtual = 1;
    const LIMITE_DE_ITENS = 10; // **** NOSSO LIMITE ****

    while (true) {
        console.log(`Extraindo dados da página ${paginaAtual}...`);
        await page.waitForSelector(seletorTabela, { state: 'visible', timeout: 60000 });

        const produtosDaPagina = await page.$$eval(seletorTabela, rows =>
            rows.map(row => {
                const columns = row.querySelectorAll('td');
                if (columns.length < 7) return null;

                const sku = columns[0]?.innerText.trim();
                const fotoElement = columns[1]?.querySelector('img');
                const foto = fotoElement ? fotoElement.src : '';
                const nome = columns[2]?.innerText.trim();
                const precoText = columns[5]?.innerText.trim();
                const preco = precoText.replace('R$', '').replace(',', '.').trim();
                
                const estoqueElement = columns[6]?.querySelector('span[data-original-title]');
                const estoqueTitle = estoqueElement ? estoqueElement.getAttribute('data-original-title') : '0';
                const estoque = parseInt(estoqueTitle) || 0;

                return { sku, foto, nome, estoque, preco };
            }).filter(p => p !== null)
        );
        
        todosOsProdutos.push(...produtosDaPagina);
        console.log(`Encontrados ${produtosDaPagina.length} produtos nesta página. Total acumulado: ${todosOsProdutos.length}`);

        // **** VERIFICAÇÃO DO LIMITE ****
        if (todosOsProdutos.length >= LIMITE_DE_ITENS) {
            console.log(`Limite de ${LIMITE_DE_ITENS} itens atingido. Finalizando extração.`);
            todosOsProdutos = todosOsProdutos.slice(0, LIMITE_DE_ITENS); // Garante que teremos exatamente 10 itens
            break; 
        }

        const proximoBotao = page.locator('li.next:not(.disabled) a');

        if (await proximoBotao.count() > 0) {
            console.log("Botão 'Próximo' encontrado. Clicando...");
            await proximoBotao.click();
            await page.waitForTimeout(2000); 
            paginaAtual++;
        } else {
            console.log("Não há mais páginas. Finalizando extração.");
            break; 
        }
    }

    console.log(`Extração final concluída. Total de ${todosOsProdutos.length} produtos encontrados.`);
    
    return {
        message: 'Produtos extraídos com sucesso!',
        totalProdutos: todosOsProdutos.length,
        produtos: todosOsProdutos,
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
