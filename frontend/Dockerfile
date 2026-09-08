# ---- Base Stage ----
FROM node:22-slim AS base

# Install dependencies only when needed
FROM base AS deps

WORKDIR /app

# Optional: allow overriding NPM/Yarn/PNPM registry via build-arg
# Default to official npm registry (HK/Global servers无需镜像)
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_TIMEOUT=600000 \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

# APT mirrors are configurable to survive regional/transient mirror failures.
# Default to HTTP because node:22-slim may not contain system CAs before apt packages are installed.
ARG APT_DEBIAN_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./

# If a custom registry is provided, configure package managers to use it
RUN npm config set registry "$NPM_REGISTRY" \
    && (yarn config set registry "$NPM_REGISTRY" 2>/dev/null || true) \
    && (corepack enable pnpm >/dev/null 2>&1 && pnpm config set registry "$NPM_REGISTRY" 2>/dev/null || true)

RUN set -eux; \
    debian_mirror="${APT_DEBIAN_MIRROR}"; \
    security_mirror="${APT_SECURITY_MIRROR}"; \
    case "${debian_mirror}" in \
      http://*|https://*) ;; \
      *) debian_mirror="http://${debian_mirror}" ;; \
    esac; \
    case "${security_mirror}" in \
      http://*|https://*) ;; \
      *) security_mirror="http://${security_mirror}" ;; \
    esac; \
    for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      [ -f "${source_file}" ] || continue; \
      sed -i \
        -e "s|http://deb.debian.org/debian|${debian_mirror}|g" \
        -e "s|https://deb.debian.org/debian|${debian_mirror}|g" \
        -e "s|http://deb.debian.org/debian-security|${security_mirror}|g" \
        -e "s|https://deb.debian.org/debian-security|${security_mirror}|g" \
        -e "s|http://security.debian.org/debian-security|${security_mirror}|g" \
        -e "s|https://security.debian.org/debian-security|${security_mirror}|g" \
        "${source_file}"; \
    done; \
    install_pkgs="python3 make g++ build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev"; \
    for attempt in 1 2 3; do \
      apt-get update \
        -o Acquire::Retries=5 \
        -o Acquire::http::Timeout=30 \
        -o Acquire::https::Timeout=30 \
        -o Acquire::ForceIPv4=true \
      && apt-get install -y --no-install-recommends --fix-missing ${install_pkgs} \
      && break; \
      if [ "${attempt}" -eq 3 ]; then \
        echo "apt install failed after ${attempt} attempts" >&2; \
        exit 1; \
      fi; \
      echo "apt install attempt ${attempt} failed, retrying in 5s..." >&2; \
      sleep 5; \
    done; \
    rm -rf /var/lib/apt/lists/*

RUN \
  if [ -f yarn.lock ]; then yarn config set registry "$NPM_REGISTRY" && yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm config set registry "$NPM_REGISTRY" && npm ci --registry="$NPM_REGISTRY"; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm config set registry "$NPM_REGISTRY" && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi


# ---- Builder Stage ----
FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_URL
ARG NEXT_PUBLIC_CANVAS_REALTIME_URL
ARG NEXT_PUBLIC_ENV_MODE
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG BACKEND_INTERNAL_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# If build args are provided (cloud/CI), generate a .env.production.local file so Next can inline NEXT_PUBLIC_* at build time.
# If args are missing (local dev), Next will fall back to the existing .env.local file in the build context.
RUN set -e; \
  envfile=".env.production.local"; \
  rm -f "$envfile"; \
  touch "$envfile"; \
  if [ -n "${NEXT_PUBLIC_BACKEND_URL:-}" ]; then printf '%s\n' "NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL" >> "$envfile"; fi; \
  if [ -n "${NEXT_PUBLIC_APP_URL:-}" ]; then printf '%s\n' "NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL" >> "$envfile"; fi; \
  if [ -n "${NEXT_PUBLIC_URL:-}" ]; then printf '%s\n' "NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL" >> "$envfile"; fi; \
  if [ -n "${NEXT_PUBLIC_CANVAS_REALTIME_URL:-}" ]; then printf '%s\n' "NEXT_PUBLIC_CANVAS_REALTIME_URL=$NEXT_PUBLIC_CANVAS_REALTIME_URL" >> "$envfile"; fi; \
  if [ -n "${NEXT_PUBLIC_ENV_MODE:-}" ]; then printf '%s\n' "NEXT_PUBLIC_ENV_MODE=$NEXT_PUBLIC_ENV_MODE" >> "$envfile"; fi; \
  if [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then printf '%s\n' "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" >> "$envfile"; fi; \
  if [ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then printf '%s\n' "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" >> "$envfile"; fi; \
  if [ -n "${BACKEND_INTERNAL_URL:-}" ]; then printf '%s\n' "BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL" >> "$envfile"; fi

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone
# Increase Node.js memory limit for build (2.5GB - safe for 3.6GB available memory)
ENV NODE_OPTIONS="--max-old-space-size=6144"

RUN \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

# ---- Runner Stage ----
FROM base AS runner
WORKDIR /app

ENV NEXT_PUBLIC_VERCEL_ENV=production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
