# ДГТУ.Сейчас — образ для Timeweb Cloud App Platform (или любого Docker-хостинга)
FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
# Корневой и выпускающий сертификаты НУЦ Минцифры — нужны для GigaChat API.
# Если скачать не удалось, кабинет всё равно работает: помощник отвечает по правилам.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && mkdir -p /usr/local/share/ca-certificates/russian-trusted \
 && (curl -fsSL https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt -o /usr/local/share/ca-certificates/russian-trusted/russian_trusted_root_ca.crt \
     && curl -fsSL https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt -o /usr/local/share/ca-certificates/russian-trusted/russian_trusted_sub_ca.crt \
     || echo "WARN: сертификаты Минцифры не скачались") \
 && update-ca-certificates \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY fonts ./fonts
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
