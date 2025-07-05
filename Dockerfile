# Usar a imagem base oficial do Playwright, que já inclui tudo que o Chrome precisa.
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Definir o diretório de trabalho dentro do container
WORKDIR /app

# Copiar os arquivos de dependência primeiro para otimizar o cache do Docker
COPY package*.json ./

# Usar o comando de instalação padrão, que é mais robusto
RUN npm install --omit=dev

# Copiar o resto do seu código
COPY . .

# Expor a porta que o nosso server.js usa
EXPOSE 10000

# O comando para iniciar o seu robô
CMD [ "npm", "start" ]
