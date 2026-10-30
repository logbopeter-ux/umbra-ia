# ─────────────────────────────────────────────────────────────
#  Umbra IA — image de production
#  Aucune dépendance npm : Node 20 + les fichiers du projet.
#  Construction :  docker build -t umbra-ia .
#  Lancement   :  docker run -p 4173:4173 -e UMBRA_PASSWORD=secret umbra-ia
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL org.opencontainers.image.title="Umbra IA" \
      org.opencontainers.image.description="Assistant personnel : chat, voix et actions réelles" \
      org.opencontainers.image.version="2.0.0"

WORKDIR /app

# Réglages par défaut adaptés à un serveur public
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    UMBRA_TIMEZONE=Africa/Porto-Novo \
    UMBRA_PUBLIC_MODE=1 \
    UMBRA_TOOLS_DISABLE=run_python,browser_control,system_command \
    UMBRA_ALLOW_SHELL=0

# su-exec : démarrer en root pour donner /app/data à « node », puis
# abandonner les privilèges (indispensable pour un disque Render monté root).
RUN apk add --no-cache su-exec && rm -rf /var/cache/apk/*

# Code applicatif (pas de node_modules : le serveur est sans dépendance)
COPY package.json ./
COPY server ./server
COPY web ./web
COPY desktop ./desktop
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Dossiers de données inscriptibles par l'utilisateur non privilégié
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data/notes /app/data/screenshots /app/data/python \
    && chown -R node:node /app

# Pas de « USER node » ici : le conteneur démarre en root le temps de
# corriger les droits du volume, puis docker-entrypoint.sh abandonne les
# privilèges avec su-exec avant de lancer l'application.
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
