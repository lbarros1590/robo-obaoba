const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// --- Funções Auxiliares ---
async function resolveCaptcha(siteKey, pageUrl, apiKey) { /* ...código completo... */ }
async function performLogin(page, email, password, captchaKey) { /* ...código completo... */ }

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
                return {
                    productId: viewButton ? viewButton.getAttribute('data-id') : null,
                    sku: columns[0]?.innerText.trim(),
                    rawTitle: columns[2]?.innerText.trim() || ''
                };
            }).filter(p => p && p.productId)
        );

        for (let product of produtosDaPagina) {
            const variant_id = `${product.sku}-${product.rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;
            allScrapedVariantIds.add(variant_id);
            const existingProduct = existingProductsMap.get(variant_id);
            product.variant_id = variant_id;
            let needsUpdate = false;
            
            if (!existingProduct || !existingProduct.brand) {
                console.log(`Produto ${product.sku} é novo ou incompleto. Buscando detalhes...`);
                needsUpdate = true;
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
                }
            } else {
                 const tempProductData = await page.evaluate(row => {
                    const columns = row.querySelectorAll('td');
                    const stock = parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0;
                    const priceCell = columns[5];
                    let purchase_price_text = priceCell ? priceCell.innerText.trim().split('\n').pop() : '0';
                    const purchase_price = parseFloat(purchase_price_text.replace('R$', '').replace(',', '.')) || 0;
                    const photo = columns[1]?.querySelector('img')?.src || null;
                    return { stock, purchase_price, photo };
                }, (await page.$(`tr:has(a[data-id="${product.productId}"])`)));

                product.stock = tempProductData.stock;
                product.purchase_price = tempProductData.purchase_price;
                if (existingProduct.purchase_price !== product.purchase_price || existingProduct.stock !== product.stock || existingProduct.photo !== tempProductData.photo) {
                    console.log(`Produto ${product.sku} teve alteração de preço/estoque/foto.`);
                    needsUpdate = true;
                    product.photo = tempProductData.photo;
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
                
                // CORREÇÃO: Garante que o título não fique vazio
                product.title = product.base_name || product.rawTitle.replace(/\s*\[(QE|ER|ME|KIT)\]\s*/gi, ' ').trim();
                
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

// --- Função Principal ---
async function obaobaSync(email, password, userId) { /* ...código completo... */ }

module.exports = obaobaSync;
