FROM node:24.17.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24.17.0-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174 NEBULA_DATA_DIR=/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/artifacts/nebula/dist/public ./artifacts/nebula/dist/public
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4174
CMD ["node", "dist-server/server/main.js"]
