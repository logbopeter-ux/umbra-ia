# ─────────────────────────────────────────────────────────────
#  Umbra IA — image de production
#  Aucune dépendance npm : Node 20 + les fichiers du projet.
#  Construction :  docker build -t umbra-ia .
#  Lancement   :  docker run -p 4173:4173 -e UMBRA_PASSWORD=secret umbra-ia
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL org.opencontainers.image.title="Umbra IA" \
      org.opencontainers.image.description="Assistant personnel : chat, voix et actions réelles" \
      org.opencontainers.image.version="2.1.0"

WORKDIR /app

# Réglages par défaut adaptés à un serveur public
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    UMBRA_TIMEZONE=Africa/Porto-Novo \
    UMBRA_PUBLIC_MODE=1 \
    UMBRA_TOOLS_DISABLE=run_python,browser_control,system_command \
    UMBRA_ALLOW_SHELL=0

# Code applicatif (pas de node_modules : le serveur est sans dépendance)
COPY package.json ./
COPY server ./server
COPY web ./web
COPY desktop ./desktop

# Dossiers de données inscriptibles par l'utilisateur non privilégié
RUN mkdir -p /app/data/notes /app/data/screenshots /app/data/python /app/data/fichiers \
    && chown -R node:node /app

USER node
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
