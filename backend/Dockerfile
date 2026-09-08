FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

# ENV_MODE can be set at build time or runtime
# Build-time default is staging, but can be overridden via --build-arg
ARG ENV_MODE=staging
ENV ENV_MODE=${ENV_MODE}
WORKDIR /app

# APT mirrors are configurable to survive regional/transient network failures.
# Default to HTTP to avoid TLS bootstrap issues in minimal base images.
ARG APT_DEBIAN_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
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
    install_pkgs="curl git libfreetype6-dev gcc poppler-utils python3-dev"; \
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

# Install Python dependencies
COPY backend/pyproject.toml backend/uv.lock ./
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked

# Copy application code
COPY backend/ ./
COPY prompts/ /app/prompts/

# Use single worker for Redis caching consistency
# Multiple workers can cause Redis connection issues
ENV WORKERS=1
ENV THREADS=2
ENV WORKER_CONNECTIONS=2000

ENV PYTHONPATH=/app
EXPOSE 8013

# Gunicorn configuration
CMD ["sh", "-c", "uv run gunicorn api:app \
  --workers $WORKERS \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8013 \
  --timeout 1800 \
  --graceful-timeout 600 \
  --keep-alive 1800 \
  --max-requests 0 \
  --max-requests-jitter 0 \
  --forwarded-allow-ips '*' \
  --worker-connections $WORKER_CONNECTIONS \
  --worker-tmp-dir /dev/shm \
  --preload \
  --log-level debug \
  --access-logfile - \
  --error-logfile - \
  --capture-output \
  --enable-stdio-inheritance \
  --threads $THREADS"]
