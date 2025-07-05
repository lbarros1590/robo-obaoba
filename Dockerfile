# Usar a imagem base oficial e mais recente do Playwright com Node.js
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Definir o diretório de trabalho dentro do container
WORKDIR /app

# Copiar os arquivos de dependência
COPY package*.json ./

# Instalar apenas as dependências de produção
RUN npm ci --omit=dev

# Copiar o resto do código do seu projeto
COPY . .

# Expor a porta que o nosso server.js usa
EXPOSE 10000

# O comando para iniciar o seu robô
CMD [ "npm", "start" ]
