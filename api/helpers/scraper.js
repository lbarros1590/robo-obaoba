// api/helpers/scraper.js

const axios = require('axios');

// Esta função agora vive aqui
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

// Esta função também vive aqui
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
                const title = columns[2]?.innerText.trim();
                const stock = parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0;

                const priceCell = columns[5];
                let purchase_price_text;
                if (priceCell) {
                    const priceParts = priceCell.innerText.trim().split('\n');
                    purchase_price_text = priceParts[priceParts.length - 1];
                } else {
                    purchase_price_text = '0';
                }
                const purchase_price = parseFloat(purchase_price_text.replace('R$', '').replace(',', '.')) || 0;

                const variant_id = `${sku}-${title.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;

                return { sku, photo, title, stock, purchase_price, variant_id, is_active: true };
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

// E a função de resolver o CAPTCHA
async function resolveCaptcha(siteKey, pageUrl, apiKey) {
    const res = await axios.post(`http://2captcha.com/in.php`, null, { params: { key: apiKey, method: 'userrecaptcha', googlekey: siteKey, pageurl: pageUrl, json: 1 } });
    const requestId = res.data.request;
    if (res.data.status !== 1) throw new Error(`Erro ao enviar CAPTCHA: ${res.data.request}`);
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const check = await axios.get(`http://2captcha.com/res.php`, { params: { key: apiKey, action: 'get', id: requestId, json: 1 } });
        if (check.data.status === 1) {
            console.log('CAPTCHA resolvido com sucesso!');
            return check.data.request;
        }
    }
}

// Exportamos as funções para que outros arquivos possam usá-las
module.exports = {
    performLogin,
    scrapeAllProducts,
    resolveCaptcha
};
