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
    
    console.log('Buscando produtos existentes no banco de dados para comparação...');
    const { data: existingProductsData, error: fetchError } = await supabase
        .from('products')
        .select('variant_id, purchase_price, stock, is_active, photo, description, brand')
        .eq('user_id', userId);
    if (fetchError) throw new Error(`Erro ao buscar produtos existentes: ${fetchError.message}`);
    const existingProductsMap = new Map(existingProductsData.map(p => [p.variant_id, p]));
    console.log(`${existingProductsMap.size} produtos existentes encontrados no banco.`);

    await page.goto('https://app.obaobamix.com.br/admin/products', { waitUntil: 'networkidle' });
    
    const { productsToUpsert, allScrapedVariantIds } = await scrapeAndEnrichProducts(page, existingProductsMap);
    
    if (productsToUpsert.length > 0) {
        console.log(`Encontrados ${productsToUpsert.length} alterações/novos produtos para salvar...`);
        const { error: upsertError } = await supabase.from('products').upsert(productsToUpsert.map(p => ({...p, user_id: userId})), { onConflict: 'variant_id' });
        if (upsertError) throw new Error(`Erro ao salvar produtos: ${upsertError.message}`);
        console.log(`${productsToUpsert.length} produtos foram salvos ou atualizados.`);
    } else {
        console.log('Nenhuma alteração de preço, estoque ou foto encontrada nos produtos existentes.');
    }
    
    const productsToDeactivate = existingProductsData.filter(p => p.is_active && !allScrapedVariantIds.has(p.variant_id));
    if (productsToDeactivate.length > 0) {
        const idsToDeactivate = productsToDeactivate.map(p => p.variant_id);
        console.log(`Encontrados ${idsToDeactivate.length} produtos para desativar...`);
        await supabase.from('products').update({ is_active: false }).in('variant_id', idsToDeactivate);
    } else {
        console.log('Nenhum produto para desativar.');
    }

    console.log('Processo finalizado com sucesso!');
  } catch (error) {
    console.error('Ocorreu um erro fatal durante a execução do robô:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Navegador fechado.');
    }
  }
}

async function performLogin(page, email, password, captchaKey) { /* ...código igual ao anterior... */ }
async function resolveCaptcha(siteKey, pageUrl, apiKey) { /* ...código igual ao anterior... */ }

async function scrapeAndEnrichProducts(page, existingProductsMap) {
    const seletorTabela = 'table.datatable-Product tbody tr';
    await page.waitForSelector(seletorTabela, { timeout: 60000 });
    const csrfToken = await page.locator('input[name="_token"]').inputValue();
    
    let productsToUpsert = [];
    let allScrapedVariantIds = new Set();
    let paginaAtual = 1;

    while (true) {
        console.log(`Extraindo dados da página ${paginaAtual}...`);
        const produtosDaPagina = await page.$$eval(seletorTabela, rows =>
            rows.map(row => {
                // Extração dos dados básicos
                // ... (código para pegar sku, rawTitle, productId, etc.)
            })
        );

        for (const product of produtosDaPagina) {
            allScrapedVariantIds.add(product.variant_id);
            const existingProduct = existingProductsMap.get(product.variant_id);

            // VERIFICA SE O PRODUTO PRECISA DE DETALHES
            if (!existingProduct || !existingProduct.brand || !existingProduct.description) {
                console.log(`Produto ${product.sku} é novo ou incompleto. Buscando detalhes...`);
                // Faz a chamada de API para buscar os detalhes
                const detailedData = await page.evaluate(async ({ prodId, token }) => { /* ...código da chamada fetch... */ });
                
                if (detailedData) {
                    // Preenche o objeto 'product' com os detalhes ricos
                    // ... (lógica para preencher description, brand, model, weight, etc.)
                }
                productsToUpsert.push(product); // Adiciona à lista de upsert pois é novo/incompleto
            } else {
                // O produto já está completo, só verifica preço e estoque
                if (existingProduct.purchase_price !== product.purchase_price || existingProduct.stock !== product.stock) {
                    console.log(`Produto ${product.sku} teve alteração de preço/estoque.`);
                    productsToUpsert.push(product); // Adiciona à lista de upsert pois mudou
                }
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

module.exports = obaobaSync;
