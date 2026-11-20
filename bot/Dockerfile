FROM node:22-alpine
WORKDIR /app
COPY telegram-bot.mjs ./
RUN mkdir /state && chown node:node /state
USER node
ENV BOT_STATE_FILE=/state/bot-state.json
CMD ["node", "telegram-bot.mjs"]
