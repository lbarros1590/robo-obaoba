// api/helpers/scraper.js
const { resolveCaptcha } = require('./captcha');

async function performLogin(page, email, password, captchaKey) {
    await page.goto('https://app.obaobamix.com.br/login', { waitUntil: 'networkidle' });
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
    const seletorTabela = 'table.datatable-Product tbody tr';
    await page.waitForSelector(seletorTabela, { timeout: 60000 });

    // Pega o token de segurança da página para usar nas chamadas de API
    const csrfToken = await page.locator('input[name="_token"]').inputValue();
    if (!csrfToken) {
        throw new Error("Não foi possível encontrar o token de segurança (CSRF) na página.");
    }

    let todosOsProdutos = [];
    let paginaAtual = 1;
    while (true) {
        console.log(`Extraindo dados da página ${paginaAtual}...`);

        // 1. Pega os dados básicos da tabela e o ID de cada produto
        const produtosDaPagina = await page.$$eval(seletorTabela, rows =>
            rows.map(row => {
                const columns = row.querySelectorAll('td');
                if (columns.length < 7) return null;

                const viewButton = row.querySelector('#btnViewProduct');
                const productId = viewButton ? viewButton.getAttribute('data-id') : null;
                const sku = columns[0]?.innerText.trim();
                const rawTitle = columns[2]?.innerText.trim() || '';

                return { productId, sku, rawTitle };
            }).filter(p => p && p.productId)
        );

        // 2. Para cada produto, busca os detalhes ricos via API interna
        for (let product of produtosDaPagina) {
            console.log(`Buscando detalhes para o produto ID: ${product.productId}`);

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
                    if (!response.ok) return null;
                    return response.json();
                } catch (e) {
                    return null;
                }
            }, { prodId: product.productId, token: csrfToken });

            if (detailedData && detailedData.product) {
                const p = detailedData.product;
                const sizeParts = detailedData.size ? detailedData.size.split('x') : [0, 0, 0];

                product.photo = p.photo && p.photo.length > 0 ? p.photo[0].url : null;
                product.stock = parseInt(p.inv) || 0;
                product.purchase_price = parseFloat(p.price) || 0;
                product.brand = p.brand ? p.brand.name : null;
                product.model = p.model;
                product.description = p.description;
                product.weight = parseFloat(p.weight) || 0;
                product.height = parseFloat(sizeParts[0]) || 0;
                product.width = parseFloat(sizeParts[1]) || 0;
                product.length = parseFloat(sizeParts[2]) || 0;

                // Lógica de limpeza de título
                let cleanTitle = product.rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                const variationMatch = cleanTitle.match(/(\[.*?\]|\(.*?\))/);
                product.variation_details = variationMatch ? variationMatch[0].replace(/\[|\]|\(|\)/g, '').trim() : null;
                product.base_name = product.variation_details ? cleanTitle.replace(variationMatch[0], '').replace(/\s+/g, ' ').trim() : cleanTitle;
                product.title = product.base_name;
                product.variant_id = `${product.sku}-${product.rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;
            }
        }

        todosOsProdutos.push(...produtosDaPagina);
        const proximoBotao = page.locator('li.next:not(.disabled) a');
        if (await proximoBotao.count() > 0) {
            await proximoBotao.click();
            await page.waitForTimeout(3000);
            paginaAtual++;
        } else {
            break;
        }
    }
    return todosOsProdutos;
}

module.exports = { performLogin, scrapeAllProducts };
