// api/helpers/database.js

async function synchronizeDatabase(supabase, userId, scrapedProducts) {
  console.log('Iniciando sincronização inteligente com o banco de dados...');

  const deDuplicatedProductsMap = new Map();
  for (const product of scrapedProducts) {
    if (product.variant_id) {
      deDuplicatedProductsMap.set(product.variant_id, product);
    }
  }
  const finalProductList = Array.from(deDuplicatedProductsMap.values());
  console.log(`Lista limpa contém ${finalProductList.length} produtos únicos.`);

  console.log('Buscando produtos existentes no banco de dados para comparação...');
  const { data: existingProductsData, error: fetchError } = await supabase
    .from('products')
    .select('variant_id, purchase_price, stock, is_active, photo')
    .eq('user_id', userId);

  if (fetchError) throw new Error(`Erro ao buscar produtos existentes: ${fetchError.message}`);

  const existingProductsMap = new Map(existingProductsData.map(p => [p.variant_id, p]));
  const productsToUpsert = [];
  const allScrapedVariantIds = new Set(finalProductList.map(p => p.variant_id));

  console.log('Comparando produtos extraídos com os dados do banco...');
  for (const scrapedProduct of finalProductList) {
    const existingProduct = existingProductsMap.get(scrapedProduct.variant_id);
    if (!existingProduct || 
        (existingProduct.purchase_price !== scrapedProduct.purchase_price ||
         existingProduct.stock !== scrapedProduct.stock ||
         existingProduct.photo !== scrapedProduct.photo ||
         !existingProduct.is_active)
    ) {
      console.log(`Produto novo ou alterado: ${scrapedProduct.sku}`);
      productsToUpsert.push({ ...scrapedProduct, user_id: userId, is_active: true });
    }
  }

  if (productsToUpsert.length > 0) {
    console.log(`Encontrados ${productsToUpsert.length} alterações/novos produtos para salvar...`);
    const { error: upsertError } = await supabase.from('products').upsert(productsToUpsert, { onConflict: 'variant_id' });
    if (upsertError) throw new Error(`Erro ao salvar produtos: ${upsertError.message}`);
    console.log(`${productsToUpsert.length} produtos foram salvos ou atualizados.`);
  } else {
    console.log('Nenhuma alteração de preço, estoque ou foto encontrada.');
  }

  const productsToDeactivate = existingProductsData.filter(p => p.is_active && !allScrapedVariantIds.has(p.variant_id));
  if (productsToDeactivate.length > 0) {
      const idsToDeactivate = productsToDeactivate.map(p => p.variant_id);
      console.log(`Encontrados ${idsToDeactivate.length} produtos para desativar...`);
      await supabase.from('products').update({ is_active: false }).in('variant_id', idsToDeactivate);
  } else {
      console.log('Nenhum produto para desativar.');
  }
}

module.exports = { synchronizeDatabase };
