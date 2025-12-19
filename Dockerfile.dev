# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

# Helps file watching when using bind mounts in Docker
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true

EXPOSE 3000

CMD ["npm","run","dev","--","--hostname","0.0.0.0","--port","3000"]


