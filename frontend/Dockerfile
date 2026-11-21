# syntax=docker/dockerfile:1

ARG CSP_API_ORIGIN=http://localhost:8001

FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into the bundle at build time, so it must be the URL a browser can reach.
ARG VITE_API_BASE=http://localhost:8001
ENV VITE_API_BASE=$VITE_API_BASE

# Contact address shown on the legal pages.
ARG VITE_CONTACT_EMAIL=contact@ytmindmap.local
ENV VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL

RUN npm run build

FROM nginx:1.27-alpine AS runtime

ARG CSP_API_ORIGIN
ENV CSP_API_ORIGIN=$CSP_API_ORIGIN

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
