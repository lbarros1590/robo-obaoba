// api/helpers/scraper.js
const { resolveCaptcha } = require('./captcha');

async function performLogin(page, email, password, captchaKey) {
    await page.goto('https://app.obaobamix.com.br/login', { waitUntil: 'networkidle' });
    await page.waitForSelector('.g-recaptcha', { timeout: 60000 });
    console.log('Elemento do CAPTCHA carregado.');
    const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
    const captchaToken = await resolveCaptcha(siteKey, page.url(), captchaKey);
    await page.evaluate(token => { document.getElementById('g-recaptcha-response').value = token; }, captchaToken);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]').click();
    
    await page.waitForURL('**/admin', { timeout: 60000 }); 
    console.log('Login e redirecionamento para /admin bem-sucedidos.');
}

// Substitua esta função em api/helpers/scraper.js
async function scrapeAllProducts(page) {
    console.log('Navegando para a página de "Todos os Produtos"...');
    await page.goto('https://app.obaobamix.com.br/admin/products', { waitUntil: 'networkidle' });

    const seletorTabela = 'table.datatable-Product tbody tr';
    console.log('Aguardando a tabela de produtos carregar...');
    await page.waitForSelector(seletorTabela, { timeout: 60000 });
    console.log('Tabela de produtos encontrada.');

    // Pega o token de segurança da página
    const csrfToken = await page.locator('form#form input[name="_token"]').inputValue();
    if (!csrfToken) {
        throw new Error("Não foi possível encontrar o token de segurança (CSRF) na página.");
    }
    console.log('Token de segurança (CSRF) capturado com sucesso.');

    let todosOsProdutos = [];
    let paginaAtual = 1;
    while (true) {
        console.log(`--- INICIANDO EXTRAÇÃO DA PÁGINA ${paginaAtual} ---`);
        
        // Pega os dados básicos da tabela
        const produtosDaPagina = await page.$$eval(seletorTabela, rows =>
            rows.map(row => {
                const viewButton = row.querySelector('#btnViewProduct');
                return {
                    productId: viewButton ? viewButton.getAttribute('data-id') : null,
                    sku: row.querySelector('td:first-child')?.innerText.trim()
                };
            }).filter(p => p && p.productId)
        );
        console.log(`${produtosDaPagina.length} produtos básicos encontrados nesta página.`);

        // Para cada produto, busca os detalhes
        for (let product of produtosDaPagina) {
            console.log(`--> Buscando detalhes para o produto ID: ${product.productId}`);
            
            const detailedData = await page.evaluate(async ({ prodId, token }) => {
                try {
                    const response = await fetch('/admin/products/view', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        body: `id=${prodId}&_token=${token}`
                    });
                    if (!response.ok) {
                        console.error(`Falha na API de detalhes para ID ${prodId}: Status ${response.status}`);
                        return null;
                    }
                    return response.json();
                } catch (e) {
                    console.error(`Erro no fetch da API de detalhes para ID ${prodId}:`, e.message);
                    return null;
                }
            }, { prodId: product.productId, token: csrfToken });

            if (detailedData && detailedData.product) {
                console.log(`---> Detalhes encontrados para o produto ID: ${product.productId}`);
                // Junta os dados detalhados aqui (a lógica completa)
                // ...
            } else {
                console.warn(`---> AVISO: Nenhum dado detalhado retornado para o produto ID: ${product.productId}`);
            }
        }

        todosOsProdutos.push(...produtosDaPagina);
        const proximoBotao = page.locator('li.next:not(.disabled) a');
        if (await proximoBotao.count() > 0) {
            await proximoBotao.click();
            await page.waitForTimeout(3000);
            paginaAtual++;
        } else {
            console.log('Não há mais páginas. Finalizando extração.');
            break;
        }
    }
    return todosOsProdutos;
}
module.exports = { performLogin, scrapeAllProducts };
