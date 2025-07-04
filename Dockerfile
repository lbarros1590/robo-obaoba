FROM node:18-slim

WORKDIR /usr/src/app

COPY package*.json ./

# Esta é a linha correta e completa que instala TUDO o que é necessário
RUN npm install && npx playwright install-deps

COPY . .

EXPOSE 10000

CMD [ "npm", "start" ]
