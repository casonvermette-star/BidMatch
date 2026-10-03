FROM node:24-alpine
WORKDIR /app
COPY . .
ENV APP_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
