ARG NODE_BASE_IMAGE=node:20-alpine
FROM ${NODE_BASE_IMAGE} AS base

WORKDIR /app

ENV NODE_ENV=production

ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_TIMEOUT=600000 \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

COPY package*.json ./
RUN npm config set registry "$NPM_REGISTRY" \
    && npm install --omit=dev --registry="$NPM_REGISTRY"

COPY src ./src

EXPOSE 6020

CMD ["node", "src/index.js"]
