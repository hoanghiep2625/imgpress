FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY server/package*.json ./
RUN npm ci

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache tini

COPY --from=builder /app/node_modules ./server/node_modules

COPY server/ ./server/

COPY client/ ./client/

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app/server

USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]