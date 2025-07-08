const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

async function obaobaSync(email, password, userId) {
  let browser = null;
  try {
    const { CAPTCHA_API_KEY } = process.env;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    console.log('Iniciando navegador...');
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    const page = await context.newPage();
    
    await performLogin(page, email, password, CAPTCHA_API_KEY);
    
    console.log('Buscando produtos existentes no banco de dados...');
    const { data: existingProductsData, error: fetchError } = await supabase
        .from('products')
        .select('variant_id, purchase_price, stock, is_active, photo, description, brand')
        .eq('user_id', userId);
    if (fetchError) throw new Error(`Erro ao buscar produtos existentes: ${fetchError.message}`);
    const existingProductsMap = new Map(existingProductsData.map(p => [p.variant_id, p]));
    console.log(`${existingProductsMap.size} produtos existentes encontrados.`);

    await page.goto('https://app.obaobamix.com.br/admin/products', { waitUntil: 'networkidle' });
    
    const { productsToUpsert, allScrapedVariantIds } = await scrapeAndEnrichProducts(page, existingProductsMap);
    
    if (productsToUpsert.length > 0) {
        console.log(`Encontrados ${productsToUpsert.length} produtos novos/alterados para salvar...`);
        const { error: upsertError } = await supabase.from('products').upsert(productsToUpsert.map(p => ({...p, user_id: userId})), { onConflict: 'variant_id' });
        if (upsertError) throw new Error(`Erro ao salvar produtos no Supabase: ${upsertError.message}`);
        console.log(`${productsToUpsert.length} produtos foram salvos ou atualizados.`);
    } else {
        console.log('Nenhuma alteração encontrada nos produtos.');
    }
    
    const productsToDeactivate = existingProductsData.filter(p => p.is_active && !allScrapedVariantIds.has(p.variant_id));
    if (productsToDeactivate.length > 0) {
        const idsToDeactivate = productsToDeactivate.map(p => p.variant_id);
        console.log(`Encontrados ${idsToDeactivate.length} produtos para desativar...`);
        await supabase.from('products').update({ is_active: false }).in('variant_id', idsToDeactivate);
        console.log('Produtos antigos foram desativados.');
    } else {
        console.log('Nenhum produto para desativar.');
    }

    console.log('Processo finalizado com sucesso!');
  } catch (error) {
    console.error('Ocorreu um erro fatal na execução do robô:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Navegador fechado.');
    }
  }
}

async function scrapeAndEnrichProducts(page, existingProductsMap) {
    const seletorTabela = 'table.datatable-Product tbody tr';
    await page.waitForSelector(seletorTabela, { timeout: 60000 });
    const csrfToken = await page.locator('form#form input[name="_token"]').inputValue();
    
    let productsToUpsert = [];
    let allScrapedVariantIds = new Set();
    let paginaAtual = 1;

    while (true) {
        console.log(`Extraindo dados da página ${paginaAtual}...`);
        const produtosDaPagina = await page.$$eval(seletorTabela, rows =>
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
                
                const variant_id = `${sku}-${rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;

                return { productId, sku, rawTitle, stock, purchase_price, variant_id, is_active: true };
            }).filter(p => p && p.productId)
        );

        for (let product of produtosDaPagina) {
            allScrapedVariantIds.add(product.variant_id);
            const existingProduct = existingProductsMap.get(product.variant_id);
            let needsUpdate = false;
            
            // Se o produto é novo ou não tem marca (sinal de que detalhes não foram coletados)
            if (!existingProduct || !existingProduct.brand) {
                console.log(`Produto ${product.sku} é novo ou incompleto. Buscando detalhes...`);
                needsUpdate = true;
                
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
                    } catch (e) { return null; }
                }, { prodId: product.productId, token: csrfToken });
                
                if (detailedData && detailedData.product) {
                    const p = detailedData.product;
                    const sizeParts = detailedData.size ? detailedData.size.split('x') : [0, 0, 0];
                    
                    product.photo = p.photo && p.photo.length > 0 ? p.photo[0].url : null;
                    product.brand = p.brand ? p.brand.name : null;
                    product.model = p.model;
                    product.description = p.description;
                    product.weight = parseFloat(p.weight) || 0;
                    product.height = parseFloat(sizeParts[0]) || 0;
                    product.width = parseFloat(sizeParts[1]) || 0;
                    product.length = parseFloat(sizeParts[2]) || 0;
                }
            } else {
                if (existingProduct.purchase_price !== product.purchase_price || existingProduct.stock !== product.stock) {
                    console.log(`Produto ${product.sku} teve alteração de preço/estoque.`);
                    needsUpdate = true;
                }
            }

            if(needsUpdate) {
                let cleanTitle = product.rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                const variationMatch = cleanTitle.match(/(\[.*?\]|\(.*?\))/);
                product.variation_details = variationMatch ? variationMatch[0].replace(/\[|\]|\(|\)/g, '').trim() : null;
                product.base_name = product.variation_details ? cleanTitle.replace(variationMatch[0], '').replace(/\s+/g, ' ').trim() : cleanTitle;
                
                const cores = ['Preto', 'Branco', 'Azul', 'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Cinza', 'Marrom', 'Laranja', 'Roxo', 'Sortido'];
                const regexCores = new RegExp(`^(${cores.join('|')})\\s+`, 'i');
                product.base_name = product.base_name.replace(regexCores, '').trim();
                product.title = product.base_name;
                
                productsToUpsert.push(product);
            }
        }

        const proximoBotao = page.locator('li.next:not(.disabled) a');
        if (await proximoBotao.count() > 0) {
            await proximoBotao.click();
            await page.waitForTimeout(3000);
            paginaAtual++;
        } else {
            break;
        }
    }
    return { productsToUpsert, allScrapedVariantIds };
}

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

module.exports = obaobaSync;
