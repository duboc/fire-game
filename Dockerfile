# --- Tap Race: single-image Cloud Run service ---
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install deps first (better layer caching). Firestore is optional; if its
# install ever fails in a constrained build it must not break the image.
# --chown so the non-root `node` user can read everything (host umask may be 077).
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && chown -R node:node /app

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

# Cloud Run injects PORT; default to 8080 for local `docker run`.
ENV PORT=8080
EXPOSE 8080

# Run as non-root.
USER node

CMD ["node", "src/server.js"]
