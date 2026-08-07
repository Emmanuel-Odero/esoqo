# ════════════════════════════════════════════════════════════════
#  CECF WordPress (Bedrock + Sage) — production image
#
#  Build context is the REPO ROOT, not this folder — the Sage theme
#  is a real pnpm workspace package (@esoko/cecf-sage-theme) and this
#  build reuses the monorepo's pnpm-lock.yaml / pnpm store, same as
#  every other Node package here. Build with:
#
#    docker build -f services/cecf-wordpress/Dockerfile .
#
#  (this is exactly what render.yaml's dockerContext: . does)
# ════════════════════════════════════════════════════════════════

# ── Stage 1: Sage theme assets (Vite) via the shared pnpm workspace ──
FROM node:20-alpine AS theme-build
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/cecf-wordpress/web/app/themes/cecf-sage/package.json \
     services/cecf-wordpress/web/app/themes/cecf-sage/package.json

# Only fetch the theme package's slice of the workspace graph.
RUN corepack prepare pnpm@$(node -pe "require('./package.json').packageManager.split('@')[1]") --activate \
    && pnpm install --filter @esoko/cecf-sage-theme --frozen-lockfile

COPY services/cecf-wordpress/web/app/themes/cecf-sage \
     services/cecf-wordpress/web/app/themes/cecf-sage

ARG APP_URL=https://childeldercare.foundation
ENV APP_URL=${APP_URL}
RUN pnpm --filter @esoko/cecf-sage-theme build

# ── Stage 2: Composer dependencies (Bedrock root + Sage theme) ──
FROM composer:2 AS vendor
WORKDIR /app
COPY services/cecf-wordpress/composer.json services/cecf-wordpress/composer.lock services/cecf-wordpress/wp-cli.yml ./
COPY services/cecf-wordpress/bin ./bin
# --no-scripts intentionally skips composer.json's post-install-cmd (arbitrary
# script execution during a Docker build is a footgun we'd rather not have),
# so bin/fix-meta-box-autoload.php — see its docblock — is run explicitly
# instead. Needed because wpackagist-plugin/meta-box ships without its own
# vendor/autoload.php, which its loader.php requires unconditionally.
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts \
    && php bin/fix-meta-box-autoload.php

WORKDIR /app/web/app/themes/cecf-sage
COPY services/cecf-wordpress/web/app/themes/cecf-sage/composer.json \
     services/cecf-wordpress/web/app/themes/cecf-sage/composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts

# ── Stage 3: runtime — nginx + php-fpm in one container ──
# (One Render service, one billed instance — every network subsite is
#  served from here; separation between sites is at the DB table level.)
FROM php:8.4-fpm-alpine AS runtime

RUN apk add --no-cache nginx supervisor mysql-client bash curl $PHPIZE_DEPS \
    && docker-php-ext-install pdo_mysql mysqli opcache \
    && pecl install redis && docker-php-ext-enable redis \
    && curl -sSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
    && chmod +x /usr/local/bin/wp \
    && apk del $PHPIZE_DEPS

COPY services/cecf-wordpress/docker/php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY services/cecf-wordpress/docker/nginx.conf /etc/nginx/nginx.conf
COPY services/cecf-wordpress/docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY services/cecf-wordpress/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /var/www/html

# Source first (web/wp, web/app/plugins and every vendor/ are
# .dockerignore'd from the build context, so this can never clobber the
# composer-built artifacts below with whatever happens to be sitting on
# the host's working tree — a clean Render checkout has none of them, and
# the build must behave the same regardless of what a developer happens
# to have composer-installed locally).
COPY services/cecf-wordpress/web ./web
COPY services/cecf-wordpress/config ./config

# Composer-built artifacts, from the vendor stage — always freshly
# resolved from composer.lock, never from the host.
COPY --from=vendor /app/composer.json /app/composer.lock /app/wp-cli.yml ./
COPY --from=vendor /app/vendor ./vendor
COPY --from=vendor /app/web/wp ./web/wp
COPY --from=vendor /app/web/app/plugins ./web/app/plugins
COPY --from=vendor /app/web/app/themes/cecf-sage/vendor ./web/app/themes/cecf-sage/vendor

# Compiled theme assets, from the theme-build stage.
COPY --from=theme-build /repo/services/cecf-wordpress/web/app/themes/cecf-sage/public/build \
     ./web/app/themes/cecf-sage/public/build

# php-fpm runs as www-data; wp-content (app/) is where WordPress, Acorn,
# and any plugin ever need to write (uploads, Acorn's view/route cache,
# .maintenance during upgrades). Core (web/wp) and vendor/ stay
# root-owned and read-only — nothing should be writing there at runtime.
RUN mkdir -p web/app/uploads \
    && chown -R www-data:www-data web/app

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
