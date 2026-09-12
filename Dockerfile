FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY bot ./bot
COPY public/auth ./public/auth

ENV HOST=0.0.0.0
ENV CORS_ORIGINS=https://larpmax-auth.vercel.app
ENV TELEGRAM_BOT_USERNAME=larpmaxbot

EXPOSE 3780

CMD ["node", "server/auth-only.js"]
