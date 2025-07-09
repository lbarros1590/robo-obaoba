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

    let todosOsProdutos = [];
    let paginaAtual = 1;
    while (true) {
        console.log(`--- INICIANDO EXTRAÇÃO DA PÁGINA ${paginaAtual} ---`);
        
        let produtosDaPagina = await page.$$eval(seletorTabela, rows =>
            rows.map(row => {
                const columns = row.querySelectorAll('td');
                if (columns.length < 7) return null;
                
                const viewButton = row.querySelector('#btnViewProduct');
                const productId = viewButton ? viewButton.getAttribute('data-id') : null;
                const sku = columns[0]?.innerText.trim();
                const rawTitle = columns[2]?.innerText.trim() || '';
                
                const stock = parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0;
                const priceCell = columns[5];
                let purchase_price_text = priceCell ? priceCell.innerText.trim().split('\n').pop() : '0';
                const purchase_price = parseFloat(purchase_price_text.replace('R$', '').replace(',', '.')) || 0;

                return { productId, sku, rawTitle, stock, purchase_price };
            }).filter(p => p && p.productId)
        );

        for (let i = 0; i < produtosDaPagina.length; i++) {
            let product = produtosDaPagina[i];
            
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
                const p = detailedData.product;
                const sizeParts = detailedData.size ? detailedData.size.split('x') : [0, 0, 0];
                
                let cleanTitle = product.rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                const variationMatch = cleanTitle.match(/(\[.*?\]|\(.*?\))/);
                
                product.photo = p.photo && p.photo.length > 0 ? p.photo[0].url : null;
                product.brand = p.brand ? p.brand.name : null;
                product.model = p.model;
                product.description = p.description;
                product.weight = parseFloat(p.weight) || 0;
                product.height = parseFloat(sizeParts[0]) || 0;
                product.width = parseFloat(sizeParts[1]) || 0;
                product.length = parseFloat(sizeParts[2]) || 0;
                product.variation_details = variationMatch ? variationMatch[0].replace(/\[|\]|\(|\)/g, '').trim() : null;
                product.base_name = product.variation_details ? cleanTitle.replace(variationMatch[0], '').replace(/\s+/g, ' ').trim() : cleanTitle;
                const cores = ['Preto', 'Branco', 'Azul', 'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Cinza', 'Marrom', 'Laranja', 'Roxo', 'Sortido'];
                const regexCores = new RegExp(`^(${cores.join('|')})\\s+`, 'i');
                product.base_name = product.base_name.replace(regexCores, '').trim();
                product.title = product.base_name || product.rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                product.variant_id = `${product.sku}-${product.rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;
                product.is_active = true;

                // Remove os campos temporários do objeto final
                delete product.productId;
                delete product.rawTitle;
            } else {
                 produtosDaPagina[i] = null; // Marca para remoção se os detalhes falharem
            }
        }
        
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
    
    // CORREÇÃO: Retorna a lista completa de produtos processados
    return todosOsProdutos;
}

module.exports = { performLogin, scrapeAllProducts };
