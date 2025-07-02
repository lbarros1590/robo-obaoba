const express = require('express');
const obaobaSync = require('./api/sync'); // Importa a lógica do nosso robô

const app = express();
const PORT = process.env.PORT || 3000; // A Railway nos dará a porta a ser usada

// Criamos um endpoint que, ao ser acessado, ativa o robô
app.get('/api/sync', async (req, res) => {
  console.log('Recebida requisição para iniciar a sincronização...');
  try {
    const produtos = await obaobaSync(); // Chama a função do robô
    console.log('Sincronização concluída com sucesso.');
    res.status(200).json(produtos);
  } catch (error) {
    console.error('Erro na rota /api/sync:', error.message);
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
