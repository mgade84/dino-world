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

# ---- Build static files ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- Production: tiny nginx image serving the static build ----
FROM nginx:alpine AS prod
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
