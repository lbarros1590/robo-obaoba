# Usar uma imagem oficial do Node.js como base
FROM node:18-slim

# Definir o diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copiar o package.json para instalar as dependências
COPY package*.json ./

# Instalar as dependências do app E as dependências de sistema do Playwright
RUN npm install && npx playwright install --with-deps

# Copiar o resto do código do seu projeto para dentro do container
COPY . .

# Expor a porta que o nosso server.js usa
EXPOSE 3000

# O comando para iniciar o seu robô
CMD [ "npm", "start" ]
