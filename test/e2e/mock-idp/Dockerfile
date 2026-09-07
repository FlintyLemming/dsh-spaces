FROM node:24-alpine
WORKDIR /app
COPY server.mjs jwks.json key.pem ./
EXPOSE 9999
CMD ["node", "server.mjs"]
