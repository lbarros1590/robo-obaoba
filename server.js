const express = require('express');
const cors = require('cors');
// Certifique-se de que o caminho para o seu robô principal está correto
const obaobaSync = require('./api/sync'); 

const app = express();
const PORT = process.env.PORT || 10000;

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());

// Middleware para verificar o token de segurança
const checkAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || token !== process.env.AUTH_SECRET_TOKEN) {
    return res.status(401).json({ message: 'Acesso não autorizado' });
  }
  next();
};

// Rota principal que ativa o robô
app.post('/api/sync', checkAuth, (req, res) => {
  console.log('Recebida requisição para iniciar a sincronização...');
  const { action, email, password, userId } = req.body;

  if (!action || !email || !password || !userId) {
    return res.status(400).json({ message: 'Ação, e-mail, senha e userId são obrigatórios.' });
  }
  
  // ===================================================================
  // === LÓGICA "FIRE-AND-FORGET" ======================================
  // ===================================================================
  // Inicia o robô em segundo plano e NÃO espera ele terminar.
  // O .catch() é para capturar qualquer erro que o robô possa ter.
  obaobaSync(action, email, password, userId).catch(err => {
    console.error("ERRO FATAL no trabalho em segundo plano:", err.message);
  });

  // Responde IMEDIATAMENTE para o painel, dizendo que a tarefa foi aceita.
  res.status(202).json({ 
    message: 'Sincronização iniciada! O processo está rodando em segundo plano.' 
  });
  // ===================================================================
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
