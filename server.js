const express = require('express');
const cors = require('cors');
const obaobaSync = require('./api/sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Middleware de verificação de segurança
const checkAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; // Pega o token do header 'Bearer SEU_TOKEN'
  if (!token || token !== process.env.AUTH_SECRET_TOKEN) {
    return res.status(401).json({ message: 'Acesso não autorizado' });
  }
  next(); // Se o token estiver correto, continua
};

// Usamos o middleware de segurança na nossa rota
app.post('/api/sync', checkAuth, (req, res) => {
  console.log('Recebida requisição para iniciar a sincronização em segundo plano...');
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
  }

  // Dispara o robô e não espera (fire-and-forget)
  obaobaSync(email, password).catch(err => {
    console.error("Erro no trabalho em segundo plano:", err.message);
  });

  res.status(202).json({ 
    message: 'Sincronização iniciada com sucesso! Os dados serão atualizados em alguns minutos.' 
  });
});

app.get('/', (req, res) => {
  res.send('Servidor do Robô ObaOba está no ar!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
