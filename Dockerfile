FROM node:22-slim
WORKDIR /srv
COPY server ./server
COPY app ./app
ENV PORT=8080 DB=/data/recettes.db NODE_OPTIONS=--no-warnings
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
