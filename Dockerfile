# ---- build stage ----
# Debian slim (not alpine): Prisma's query engine needs glibc + OpenSSL 3,
# which alpine/musl doesn't provide cleanly (it asks for libssl.so.1.1).
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build
# compile the seed script too (it lives outside src rootDir)
RUN npx tsc prisma/seed.ts --outDir dist --module CommonJS --target ES2021 \
    --esModuleInterop --skipLibCheck --resolveJsonModule

# ---- runtime stage ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# postgresql-client-16 (PGDG) gives the app pg_dump/pg_restore matching the
# postgres:16 server — powers the staff console's backup & restore page.
# gosu lets the entrypoint drop from root to the app user after fixing volume
# perms; postgresql-client-16 (PGDG) powers backup/restore.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg gosu \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo \"$VERSION_CODENAME\")-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
# Unprivileged runtime user (CQ-11).
RUN useradd -r -u 10001 -m -d /home/opencard opencard
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY src/public ./dist/public
# In-app API reference (/admin/api-docs) renders this at runtime.
COPY docs ./docs
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/uploads /app/backups \
    && chown -R opencard:opencard /app
EXPOSE 3000
# Entrypoint starts as root, fixes writable-dir ownership, then drops to the
# opencard user via gosu (see deploy/entrypoint.sh). The image default runs the
# server; production overrides `command` to run migrations first.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server.js"]
