const express = require('express');
const cors = require('cors'); // <-- NOVA LINHA 1: Importa a ferramenta CORS
const obaobaSync = require('./api/sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // <-- NOVA LINHA 2: Habilita a permissão para todos os domínios

// Endpoint que ativa o robô
app.get('/api/sync', async (req, res) => {
  console.log('Recebida requisição para iniciar a sincronização...');
  try {
    const produtos = await obaobaSync();
    console.log('Sincronização concluída com sucesso.');
    res.status(200).json(produtos);
  } catch (error) {
    console.error('Erro na rota /api/sync:', error.message);
    // Adicionamos um objeto de erro mais detalhado
    res.status(500).json({ message: 'Falha ao executar a sincronização.', error: error.message });
  }
});

// Endpoint inicial para sabermos que o servidor está no ar
app.get('/', (req, res) => {
  res.send('Servidor do Robô ObaOba está no ar!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
