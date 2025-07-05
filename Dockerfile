# Usar a imagem base oficial do Playwright, que já inclui tudo.
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Definir o diretório de trabalho
WORKDIR /app

# Copiar os arquivos de dependência
COPY package*.json ./

# Instalar as dependências de produção
RUN npm install --omit=dev

# Copiar o resto do seu código
COPY . .

# Expor a porta que o nosso server.js usa
EXPOSE 10000

# O comando para iniciar o SERVIDOR WEB
CMD [ "npm", "start" ]
