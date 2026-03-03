FROM node:20-alpine AS base
WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build gateway
RUN npm run pvp:gateway:build

# Run as non-root
RUN addgroup -S app && adduser -S app -G app \
	&& chown -R app:app /app

USER app

EXPOSE 8787

CMD ["node", "services/pvp-gateway/dist/index.js"]
