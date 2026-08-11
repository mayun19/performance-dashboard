FROM node:20-slim AS builder
WORKDIR /app
RUN npm i -g pnpm@10.33.2
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.cjs .npmrc ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN cd apps/web && npm run build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80