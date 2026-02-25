FROM node:20-alpine AS base
WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build gateway
RUN npm run pvp:gateway:build

EXPOSE 8787

CMD ["node", "services/pvp-gateway/dist/index.js"]
