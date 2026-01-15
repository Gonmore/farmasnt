FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_API_URL
# Backwards compatibility: older compose files used VITE_API_URL.
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL:-$VITE_API_URL}

RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/vite.config.ts ./vite.config.ts

EXPOSE 6001

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "6001", "--strictPort"]



