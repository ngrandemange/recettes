FROM node:22-slim
WORKDIR /srv
COPY server ./server
COPY app ./app
ENV PORT=8080 DB=/data/recettes.db NODE_OPTIONS=--no-warnings
VOLUME /data
EXPOSE 8080
CMD ["node", "server/server.js"]
