FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    FEEDSTR_BIND_HOST=0.0.0.0 \
    FEEDSTR_BIND_PORT=3002 \
    FEEDSTR_DB_STORE=/data/feedstr.db

COPY package.json ./
COPY src ./src
COPY public ./public

# Feedstr persists its own metadata (columns, feed rules, cached notes) under /data.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3002
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
