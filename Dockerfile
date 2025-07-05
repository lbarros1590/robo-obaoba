FROM mcr.microsoft.com/playwright/javascript:v1.40.0-jammy

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 10000

CMD [ "npm", "start" ]
