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
// Substitua esta função em api/helpers/scraper.js

async function scrapeAllProducts(page) {
    console.log('Navegando para a página de "Todos os Produtos"...');
    await page.goto('https://app.obaobamix.com.br/admin/products', { waitUntil: 'networkidle' });

    const seletorTabela = 'table.datatable-Product tbody tr';
    console.log('Aguardando a tabela de produtos carregar...');
    await page.waitForSelector(seletorTabela, { timeout: 60000 });
    console.log('Tabela de produtos encontrada.');

    const csrfToken = await page.locator('form#form input[name="_token"]').inputValue();
    if (!csrfToken) {
        throw new Error("Não foi possível encontrar o token de segurança (CSRF) na página.");
    }
    console.log('Token de segurança (CSRF) capturado com sucesso.');

    let todosOsProdutos = [];
    let paginaAtual = 1;
    while (true) {
        console.log(`--- INICIANDO EXTRAÇÃO DA PÁGINA ${paginaAtual} ---`);
        
        let produtosDaPagina = await page.$$eval(seletorTabela, rows =>
            rows.map(row => {
                const viewButton = row.querySelector('#btnViewProduct');
                return {
                    productId: viewButton ? viewButton.getAttribute('data-id') : null,
                    sku: row.querySelector('td:first-child')?.innerText.trim(),
                    rawTitle: row.querySelector('td:nth-child(3)')?.innerText.trim() || ''
                };
            }).filter(p => p && p.productId)
        );
        console.log(`${produtosDaPagina.length} produtos básicos encontrados nesta página.`);

        for (let i = 0; i < produtosDaPagina.length; i++) {
            let product = produtosDaPagina[i];
            console.log(`--> Buscando detalhes para o produto ID: ${product.productId}`);
            
            const detailedData = await page.evaluate(async ({ prodId, token }) => {
                try {
                    const response = await fetch('/admin/products/view', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
                        body: `id=${prodId}&_token=${token}`
                    });
                    if (!response.ok) return null;
                    return response.json();
                } catch (e) { return null; }
            }, { prodId: product.productId, token: csrfToken });

            if (detailedData && detailedData.product) {
                console.log(`---> Detalhes encontrados para o produto ID: ${product.productId}`);
                const p = detailedData.product;
                const sizeParts = detailedData.size ? detailedData.size.split('x') : [0, 0, 0];
                
                // Limpa o título
                let cleanTitle = product.rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                const variationMatch = cleanTitle.match(/(\[.*?\]|\(.*?\))/);
                const variationDetails = variationMatch ? variationMatch[0].replace(/\[|\]|\(|\)/g, '').trim() : null;
                let baseName = variationDetails ? cleanTitle.replace(variationMatch[0], '').replace(/\s+/g, ' ').trim() : cleanTitle;
                const cores = ['Preto', 'Branco', 'Azul', 'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Cinza', 'Marrom', 'Laranja', 'Roxo', 'Sortido'];
                const regexCores = new RegExp(`^(${cores.join('|')})\\s+`, 'i');
                baseName = baseName.replace(regexCores, '').trim();

                // Monta o objeto final do produto com todos os dados
                const finalProduct = {
                    sku: product.sku,
                    photo: p.photo && p.photo.length > 0 ? p.photo[0].url : null,
                    title: baseName || product.rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim(),
                    stock: parseInt(p.inv) || 0,
                    purchase_price: parseFloat(p.price) || 0,
                    variant_id: `${product.sku}-${product.rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`,
                    is_active: true,
                    base_name: baseName,
                    variation_details: variationDetails,
                    parent_sku: null,
                    brand: p.brand ? p.brand.name : null,
                    model: p.model,
                    description: p.description,
                    weight: parseFloat(p.weight) || 0,
                    height: parseFloat(sizeParts[0]) || 0,
                    width: parseFloat(sizeParts[1]) || 0,
                    length: parseFloat(sizeParts[2]) || 0
                };
                
                produtosDaPagina[i] = finalProduct;
            } else {
                console.warn(`---> AVISO: Nenhum dado detalhado retornado para o produto ID: ${product.productId}`);
                produtosDaPagina[i] = null; // Marca para remoção se os detalhes falharem
            }
        }
        
        // Adiciona apenas os produtos que foram enriquecidos com sucesso
        todosOsProdutos.push(...produtosDaPagina.filter(p => p !== null));
        
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
    // Retorna a lista completa de produtos processados
    return todosOsProdutos;
}
module.exports = { performLogin, scrapeAllProducts };
