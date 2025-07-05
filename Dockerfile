# Imagem base com suporte ao Chromium headless
FROM node:20-alpine

# Instala dependências necessárias para o Chromium funcionar no ambiente cloud
RUN apk add --no-cache \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    chromium

# Define diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependências e instala os pacotes
COPY package*.json ./
RUN npm install

# Copia o restante da aplicação
COPY . .

# Define variáveis de ambiente padrão do Chromium headless
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

# Porta padrão (caso necessário)
EXPOSE 3000

# Comando de inicialização da aplicação
CMD ["node", "api/index.js"]
