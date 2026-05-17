FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM deps AS build
COPY . .
RUN bun run build

FROM oven/bun:1.2-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV STORAGE_PATH=/host
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend ./backend
COPY package.json ./
EXPOSE 3001
CMD ["bun", "run", "backend/server.ts"]
