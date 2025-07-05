const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

async function obaobaSync(email, password, userId) {
  let browser = null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { CAPTCHA_API_KEY } = process.env;
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    await performLogin(page, email, password, CAPTCHA_API_KEY);
    await page.goto('https://app.obaobamix.com.br/admin/products', { waitUntil: 'networkidle' });

    const todosOsProdutosExtraidos = await scrapeAllProducts(page);
    console.log(`Extração concluída. Total de ${todosOsProdutosExtraidos.length} produtos encontrados.`);

    if (todosOsProdutosExtraidos.length > 0) {
        console.log('Iniciando sincronização com o banco de dados Supabase...');

        // Passo 1: Limpar e preparar os dados para o banco
        const deDuplicatedProductsMap = new Map();
        for (const product of todosOsProdutosExtraidos) {
            if (product.variant_id) {
                deDuplicatedProductsMap.set(product.variant_id, product);
            }
        }
        const finalProductList = Array.from(deDuplicatedProductsMap.values());
        console.log(`Lista final contém ${finalProductList.length} produtos únicos para salvar.`);

        const produtosParaSalvar = finalProductList.map(p => ({
            variant_id: p.variant_id,
            sku: p.sku,
            title: p.title,
            stock: p.stock,
            purchase_price: p.purchase_price,
            is_active: true, // Garante que todos os produtos da lista estão ativos
            user_id: userId
        }));

        // Passo 2: Upsert (inserir ou atualizar) todos os produtos
        const { error: upsertError } = await supabase
            .from('products')
            .upsert(produtosParaSalvar, { onConflict: 'variant_id' }); 

        if (upsertError) {
            // Se o upsert falhar, mostre o erro detalhado no log
            console.error("ERRO DETALHADO DO UPSERT:", upsertError);
            throw new Error(`Erro ao salvar produtos no Supabase: ${upsertError.message}`);
        }
        console.log(`${produtosParaSalvar.length} produtos foram salvos ou atualizados no banco.`);

        // Passo 3: Desativar produtos que não vieram na lista
        const receivedVariantIds = finalProductList.map(p => p.variant_id);
        const { data: productsToDeactivate, error: selectError } = await supabase
            .from('products')
            .select('variant_id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .not('variant_id', 'in', `(${receivedVariantIds.map(id => `"${id}"`).join(',')})`); // Garante formatação correta

        if (selectError) {
            console.error('Erro ao buscar produtos para desativar:', selectError.message);
        } else if (productsToDeactivate && productsToDeactivate.length > 0) {
            const idsToDeactivate = productsToDeactivate.map(p => p.variant_id);
            const { error: deactivateError } = await supabase
                .from('products')
                .update({ is_active: false })
                .in('variant_id', idsToDeactivate);

            if (deactivateError) console.error('Erro ao desativar produtos antigos:', deactivateError.message);
            else console.log(`${idsToDeactivate.length} produtos antigos foram desativados com sucesso.`);
        } else {
            console.log('Nenhum produto antigo para desativar.');
        }
    }

    console.log('Sincronização com o banco de dados concluída!');
    return { message: 'Sincronização completa realizada com sucesso!', totalProdutos: todosOsProdutosExtraidos.length };

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

// ... (COLE AQUI AS FUNÇÕES AUXILIARES COMPLETAS: performLogin, scrapeAllProducts, resolveCaptcha) ...
// É crucial que as funções auxiliares que já te passei estejam aqui para o código funcionar.

module.exports = obaobaSync;
