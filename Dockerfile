FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci --omit=dev && npm cache clean --force

COPY server.js index.html auth.html styles.css auth.css app.js auth.js ./

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
