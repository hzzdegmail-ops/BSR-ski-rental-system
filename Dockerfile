FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /var/lib/bsr && chown node:node /var/lib/bsr
USER node
ENV HOST=0.0.0.0 PORT=8080 BSR_DATA_DIR=/var/lib/bsr
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "cloud.mjs"]
