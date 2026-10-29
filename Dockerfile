FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Placeholders so route modules can load during the build; real values come from the runtime environment.
RUN DATABASE_URL=postgres://build:build@localhost/build \
    NEON_AUTH_BASE_URL=https://build.invalid/neondb/auth \
    NEON_AUTH_COOKIE_SECRET=build-placeholder-not-a-secret-0000000000 \
    DISABLE_SCHEDULER=1 npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# One machine: apply pending migrations, then serve. Next hosts the dashboard, API, Telegram webhook, scheduler and
# (WHATSAPP_ENABLED=1) the WhatsApp socket.
CMD ["sh", "-c", "npm run db:migrate && npm start"]
