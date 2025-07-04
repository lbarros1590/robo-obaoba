const express = require('express');
const cors = require('cors');
const obaobaSync = require('./api/sync');

const app = express();
const PORT = process.env.PORT || 10000;

// --- CONFIGURAÇÃO DE CORS EXPLÍCITA E ROBUSTA ---
// Esta é a correção para o "Erro de Rede"
const corsOptions = {
  origin: '*', // Permite requisições de qualquer origem
  methods: ['GET', 'POST', 'OPTIONS'], // Permite os métodos necessários
  allowedHeaders: ['Content-Type', 'Authorization'], // Permite os headers que o seu painel envia
};
app.use(cors(corsOptions));
// --- FIM DA CONFIGURAÇÃO DE CORS ---

app.use(express.json());

// Middleware de segurança para verificar nosso token secreto
const checkAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || token !== process.env.AUTH_SECRET_TOKEN) {
    return res.status(401).json({ message: 'Acesso não autorizado' });
  }
  next();
};

// Rota que o painel vai chamar
app.post('/api/sync', checkAuth, (req, res) => {
  console.log('Recebida requisição para iniciar a sincronização em segundo plano...');
  const { email, password, userId } = req.body;
  if (!email || !password || !userId) {
    console.error('Requisição recebida sem as credenciais completas.');
    return res.status(400).json({ message: 'E-mail, senha e userId são obrigatórios.' });
  }

  // Dispara o robô e NÃO espera pela resposta (fire-and-forget)
  obaobaSync(email, password, userId).catch(err => {
    console.error("ERRO FATAL no trabalho em segundo plano:", err.message);
  });

  // Responde IMEDIATAMENTE para o painel
  res.status(202).json({ 
    message: 'Sincronização iniciada com sucesso! Os dados serão atualizados em alguns minutos.' 
  });
});

app.get('/', (req, res) => {
  res.send('Servidor do Robô ObaOba está no ar e pronto!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
