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

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    console.log('Recebida requisição para iniciar a sincronização...');
    await performLogin(page, email, password, CAPTCHA_API_KEY);

    await page.goto('https://app.obaobamix.com.br/admin/products', { waitUntil: 'networkidle' });

    const scrapedProducts = await scrapeAllProducts(page);
    console.log(`Extração concluída. Total de ${scrapedProducts.length} produtos encontrados.`);

    if (scrapedProducts.length > 0) {
      await synchronizeDatabase(supabase, userId, scrapedProducts);
    }

    console.log('Processo finalizado com sucesso!');
    return { message: 'Sincronização completa realizada com sucesso!', totalProdutos: scrapedProducts.length };

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

    if (!existingProduct) {
      // 1. Produto é novo, adiciona à lista para inserir
      console.log(`NOVO PRODUTO: ${scrapedProduct.sku}`);
      productsToUpsert.push({ ...scrapedProduct, user_id: userId });
    } else {
      // 2. Produto já existe, verifica se há mudanças ou se precisa reativar
      if (
          existingProduct.purchase_price !== scrapedProduct.purchase_price ||
          existingProduct.stock !== scrapedProduct.stock ||
          existingProduct.photo !== scrapedProduct.photo ||
          !existingProduct.is_active
      ) {
          console.log(`PRODUTO ALTERADO: ${scrapedProduct.sku}`);
          productsToUpsert.push({ ...scrapedProduct, user_id: userId, is_active: true });
      }
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
      const { error: deactivateError } = await supabase
          .from('products')
          .update({ is_active: false })
          .in('variant_id', idsToDeactivate);
      if (deactivateError) console.error('Erro ao desativar produtos antigos:', deactivateError.message);
      else console.log('Produtos antigos foram desativados com sucesso.');
  } else {
      console.log('Nenhum produto para desativar.');
  }
}


async function performLogin(page, email, password, captchaKey) {
  await page.goto('https://app.obaobamix.com.br/login', { waitUntil: 'networkidle' });

  const siteKey = await page.locator('.g-recaptcha').getAttribute('data-sitekey');
  const captchaToken = await resolveCaptcha(siteKey, page.url(), captchaKey);

  await page.evaluate((token) => {
    document.getElementById('g-recaptcha-response').value = token;
  }, captchaToken);

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

    const produtosDaPagina = await page.$$eval(seletorTabela, (rows) =>
      rows
        .map((row) => {
          const columns = row.querySelectorAll('td');
          if (columns.length < 7) return null;

          const sku = columns[0]?.innerText.trim();
          const photoElement = columns[1]?.querySelector('img');
          const photo = photoElement ? photoElement.src : null;
          const title = columns[2]?.innerText.trim();
          const stock = parseInt(columns[6]?.querySelector('span')?.getAttribute('data-original-title')) || 0;
          
          // ==================================================================
          // ALTERAÇÃO PARA PEGAR O PREÇO CORRETO (PROMOCIONAL)
          // ==================================================================
          const priceCell = columns[5];
          let purchase_price_text;
          
          if (priceCell) {
            // Quando há promoção, o texto tem duas linhas. Ex: "R$ 45,30\nR$ 35,00"
            // Nós pegamos o texto todo, dividimos pela quebra de linha, e pegamos a última parte.
            const priceParts = priceCell.innerText.trim().split('\n');
            purchase_price_text = priceParts[priceParts.length - 1];
          } else {
            purchase_price_text = '0'; // Define um valor padrão caso a célula de preço não exista
          }
          
          // Limpa o texto (ex: "R$ 35,00") e converte para número (ex: 35.00)
          const purchase_price = parseFloat(purchase_price_text.replace('R$', '').replace(',', '.')) || 0;
          // ==================================================================
          // FIM DA ALTERAÇÃO
          // ==================================================================

          const slugifiedTitle = title
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

          const variant_id = `${sku}-${slugifiedTitle}`;

          return {
            sku,
            photo,
            title,
            stock,
            purchase_price,
            variant_id,
            is_active: true,
          };
        })
        .filter((p) => p && p.sku)
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

async function resolveCaptcha(siteKey, pageUrl, apiKey) {
  const res = await axios.post('https://2captcha.com/in.php', null, {
    params: {
      key: apiKey,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      json: 1,
    },
  });

  const requestId = res.data.request;
  if (res.data.status !== 1) {
    throw new Error(`Erro ao enviar CAPTCHA: ${res.data.request}`);
  }

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const check = await axios.get('https://2captcha.com/res.php', {
      params: {
        key: apiKey,
        action: 'get',
        id: requestId,
        json: 1,
      },
    });

    if (check.data.status === 1) {
      console.log('CAPTCHA resolvido com sucesso!');
      return check.data.request;
    }
  }
}

module.exports = obaobaSync;

