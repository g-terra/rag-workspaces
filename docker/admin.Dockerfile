# Builds apps/admin into static files and serves them with nginx.
FROM node:22.23-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
# Keycloak as the browser sees it; Vite bakes it into the bundle (apps/admin/src/auth/oidc.ts).
ARG KEYCLOAK_PUBLIC_URL=http://localhost:8081
ENV VITE_KEYCLOAK_URL=$KEYCLOAK_PUBLIC_URL
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@rag/admin...

FROM nginx:1.30.7-alpine AS runtime
COPY docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
