const express = require('express');
const cors = require('cors');
const obaobaSync = require('./api/sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json()); // <-- Adicionado: Habilita o recebimento de dados em JSON

// --- ROTA ALTERADA PARA POST ---
app.post('/api/sync', async (req, res) => {
  console.log('Recebida requisição para iniciar a sincronização...');

  // Pega o e-mail e senha enviados pelo painel do Lovable
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
  }

  try {
    // Passa o e-mail e a senha para a função do robô
    const produtos = await obaobaSync(email, password); 
    console.log('Sincronização concluída com sucesso.');
    res.status(200).json(produtos);
  } catch (error) {
    console.error('Erro na rota /api/sync:', error.message);
    res.status(500).json({ message: 'Falha ao executar a sincronização.', error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor do Robô ObaOba está no ar!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
