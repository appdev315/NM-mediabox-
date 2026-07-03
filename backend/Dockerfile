FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npm install pm2

COPY . .

EXPOSE 7860
ENV PORT=7860

CMD ["npx", "pm2-runtime", "ecosystem.config.cjs"]
