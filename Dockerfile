# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
# The npm 10 bundled with Node 22 ships dependencies with known CVEs (brace-expansion, sigstore, …).
RUN npm install -g npm@11.21.1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Development: Vite dev server with hot reload (source is bind-mounted) ----
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ---- Danish speech: list every spoken phrase from the string tables ----
FROM deps AS phrases
COPY . .
RUN npx vite build --ssr scripts/voice/phrases.ts --outDir /tmp/voice --logLevel error \
 && node /tmp/voice/phrases.js

# ---- Danish speech: record the phrases with Piper (MIT; voice trained on a CC0 dataset) ----
# No apt packages (ffmpeg, curl): they brought ~170 unpatched Debian CVEs. Encoding and the download use Python.
FROM python:3.12-slim AS voice
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir piper-tts==1.3.0 lameenc==1.9.0
RUN python -c "import urllib.request as u, os; os.mkdir('/voices'); \
base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/da/da_DK/talesyntese/medium/da_DK-talesyntese-medium'; \
[u.urlretrieve(base + ext, '/voices/da' + ext) for ext in ('.onnx', '.onnx.json')]"
COPY scripts/voice/generate.py /generate.py
COPY --from=phrases /app/public/voice /out
# The cache keeps recordings between builds, so only new or changed phrases are recorded.
RUN --mount=type=cache,target=/cache python /generate.py /out/da /cache/da

# Just the clips, for `scripts/voice/build.sh` to export into public/voice for the dev server.
FROM scratch AS voice-files
COPY --from=voice /out /

# ---- Build static files ----
FROM deps AS build
COPY . .
COPY --from=voice /out public/voice
RUN npm run build

# ---- Production: tiny nginx image serving the static build ----
FROM nginx:alpine AS prod
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
