# Builds apps/api and the workspace packages it uses, then ships only the
# compiled output and production dependencies.
FROM node:22.23-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@rag/api...
RUN pnpm --filter=@rag/api deploy --legacy --prod /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# The uploads volume takes this folder's owner when Docker first creates it.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
