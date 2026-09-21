# syntax=docker/dockerfile:1
#
# LogicLab 一键构建：node:20-alpine
#   阶段 1 构建 React 前端 -> frontend/dist
#   阶段 2 编译后端 TypeScript -> backend/dist
#   运行阶段只保留编译产物与 production 依赖，单容器由后端在 8080
#   同时提供 API 与前端静态文件。

FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
# typescript 是 devDependency，但编译需要它；alpine 上直接用 npm install 即可
RUN npm install --no-audit --no-fund
COPY backend/ ./
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /app/backend

# 后端运行时不依赖任何第三方包（仅用 node 内置模块），
# 这里仍拷贝 package.json 以保留元信息；产物直接用 node 运行。
COPY backend/package.json ./
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

EXPOSE 8080
# 简单的存活状态检查：API health
RUN apk add --no-cache wget >/dev/null 2>&1 || true
HEALTHCHECK --interval=20s --timeout=4s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "dist/src/server.js"]
