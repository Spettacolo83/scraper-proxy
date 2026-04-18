FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "src/server.js"]
