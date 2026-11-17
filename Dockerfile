# FORGE in a container. The model stays on the host (Ollama); data stays in a named volume.
FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node scripts/build-worker.mjs && npx next build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 FORGE_HOME=/data FORGE_IN_DOCKER=1
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app/.next
USER node
EXPOSE 3110
CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3110"]
