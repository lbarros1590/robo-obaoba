const parseArgs = require('minimist');
const obaobaSync = require('./api/sync');

console.log('============================================');
console.log('== SERVIÇO DE SINCRONIZAÇÃO RENDER INICIADO ==');
console.log('============================================');

// Esta função lê os argumentos passados pela Render
// Ex: --email="user@exemplo.com" --password="123" --userId="..."
const args = parseArgs(process.argv.slice(2));

const { email, password, userId } = args;

// Se os argumentos não foram passados, encerra com erro.
if (!email || !password || !userId) {
  console.error('ERRO CRÍTICO: E-mail, senha e userId são obrigatórios e não foram fornecidos como argumentos.');
  process.exit(1); // Encerra o processo com código de erro
}

console.log(`Iniciando sincronização para o usuário: ${userId}`);

// Inicia o processo principal do robô
obaobaSync(email, password, userId)
  .then(result => {
    console.log('✅ PROCESSO CONCLUÍDO COM SUCESSO!');
    console.log('Mensagem:', result.message);
    console.log('Total de produtos:', result.totalProdutos);
    process.exit(0); // Encerra o processo com sucesso
  })
  .catch(err => {
    console.error('❌ ERRO FATAL NO PROCESSO DE SINCRONIZAÇÃO:');
    console.error(err);
    process.exit(1); // Encerra o processo com erro
  });
