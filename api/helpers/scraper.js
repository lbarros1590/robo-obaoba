const { resolveCaptcha } = require('./captcha');

async function performLogin(page, email, password, captchaKey) {
    await page.goto('https://app.obaobamix.com.br/login', { waitUntil: 'networkidle' });
    await page.waitForSelector('.g-recaptcha', { timeout: 60000 });
    const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
    const captchaToken = await resolveCaptcha(siteKey, page.url(), captchaKey);
    await page.evaluate(token => { document.getElementById('g-recaptcha-response').value = token; }, captchaToken);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForSelector('.datatable-Product', { timeout: 60000 });
    console.log('Login e acesso à área de administração confirmados!');
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

                const sku = columns[0]?.innerText.trim();
                const photoElement = columns[1]?.querySelector('img');
                const photo = photoElement ? photoElement.src : null;
                const rawTitle = columns[2]?.innerText.trim() || '';
                const stock = parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0;
                
                const priceCell = columns[5];
                const priceParts = priceCell ? priceCell.innerText.trim().split('\n') : ['0'];
                const purchase_price_text = priceParts[priceParts.length - 1];
                const purchase_price = parseFloat(purchase_price_text.replace('R$', '').replace(',', '.')) || 0;

                const variant_id = `${sku}-${rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;
                
                let cleanTitle = rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                const variationMatch = cleanTitle.match(/(\[.*?\]|\(.*?\))/);
                const variationDetails = variationMatch ? variationMatch[0].replace(/\[|\]|\(|\)/g, '').trim() : null;
                let baseName = variationDetails ? cleanTitle.replace(variationMatch[0], '').replace(/\s+/g, ' ').trim() : cleanTitle;
                const cores = ['Preto', 'Branco', 'Azul', 'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Cinza', 'Marrom', 'Laranja', 'Roxo', 'Sortido'];
                const regexCores = new RegExp(`^(${cores.join('|')})\\s+`, 'i');
                baseName = baseName.replace(regexCores, '').trim();
                
                return { 
                    sku, 
                    photo, 
                    title: baseName || rawTitle, // Usa o nome limpo, ou o original se a limpeza resultar em vazio
                    stock, 
                    purchase_price, 
                    variant_id, 
                    is_active: true,
                    base_name: baseName,
                    variation_details: variationDetails,
                    parent_sku: null
                };
            }).filter(p => p && p.sku)
        );
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
