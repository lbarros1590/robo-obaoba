# Usar a imagem base oficial e mais recente do Playwright com Node.js 18
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Definir o diretório de trabalho dentro do container
WORKDIR /app

# Copiar os arquivos de dependência primeiro para otimizar o cache do Docker
COPY package*.json ./

# Instalar apenas as dependências de produção de forma mais limpa
RUN npm ci --omit=dev

# Copiar o resto do seu código
COPY . .

# Expor a porta que o nosso server.js usa
EXPOSE 10000

# O comando para iniciar o seu robô
CMD [ "npm", "start" ]
