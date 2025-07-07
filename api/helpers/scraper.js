// api/helpers/scraper.js

// Importa a função de resolver o captcha, que está em outro arquivo do helper
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
                let rawTitle = columns[2]?.innerText.trim() || '';
                
                // ==================================================================
                // LÓGICA DE LIMPEZA DE TÍTULO (JÁ IMPLEMENTADA)
                // ==================================================================
                const originalTitleForVariant = rawTitle;
                let cleanTitle = rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                cleanTitle = cleanTitle.replace(/\[.*?\]/g, '').trim();
                const cores = ['Preto', 'Branco', 'Azul', 'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Cinza', 'Marrom', 'Laranja', 'Roxo', 'Sortido'];
                const regexCores = new RegExp(`^(${cores.join('|')})\\s+`, 'i');
                cleanTitle = cleanTitle.replace(regexCores, '').trim();
                cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
                const finalTitle = cleanTitle;
                // ==================================================================
                
                // ==================================================================
                // NOVA LÓGICA PARA PEGAR O PREÇO CORRETO (PROMOCIONAL)
                // ==================================================================
                const priceCell = columns[5];
                let purchase_price_text;
                if (priceCell) {
                    const priceParts = priceCell.innerText.trim().split('\n');
                    purchase_price_text = priceParts[priceParts.length - 1];
                } else {
                    purchase_price_text = '0';
                }
                const purchase_price = parseFloat(purchase_price_text.replace('R$', '').replace(',', '.')) || 0;
                // ==================================================================
                
                const stock = parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0;
                const variant_id = `${sku}-${originalTitleForVariant.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;
                
                return { 
                    sku, 
                    photo, 
                    title: finalTitle,
                    stock, 
                    purchase_price, 
                    variant_id, 
                    is_active: true 
                };
            }).filter(p => p && p.sku)
        );
        todosOsProdutos.push(...produtosDaPagina);
        const proximoBotao = page.locator('li.next:not(.disabled) a');
        if (await proximoBotao.count() > 0) {
            await proximoBotao.click();
            await page.waitForTimeout(2500);
            paginaAtual++;
        } else {
            break;
        }
    }
    return todosOsProdutos;
}

module.exports = { performLogin, scrapeAllProducts };
