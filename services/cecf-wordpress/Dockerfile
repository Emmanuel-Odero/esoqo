# ════════════════════════════════════════════════════════════════
#  CECF WordPress (Bedrock + Sage) — production image
#
#  Build context is the REPO ROOT, not this folder — the Sage theme
#  is a real pnpm workspace package (@esoqo/cecf-sage-theme) and this
#  build reuses the monorepo's pnpm-lock.yaml / pnpm store, same as
#  every other Node package here. Build with:
#
#    docker build -f services/cecf-wordpress/Dockerfile .
#
#  (the build context is the repo root)
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
    && pnpm install --filter @esoqo/cecf-sage-theme --frozen-lockfile

COPY services/cecf-wordpress/web/app/themes/cecf-sage \
     services/cecf-wordpress/web/app/themes/cecf-sage

ARG APP_URL=https://childeldercare.foundation
ENV APP_URL=${APP_URL}
RUN pnpm --filter @esoqo/cecf-sage-theme build

# ── Stage 2: Composer dependencies (Bedrock root + Sage theme) ──
FROM composer:2 AS vendor
WORKDIR /app
COPY services/cecf-wordpress/composer.json services/cecf-wordpress/composer.lock services/cecf-wordpress/wp-cli.yml ./
# --no-scripts: arbitrary script execution during a Docker build is a
# footgun we'd rather not have; nothing in composer.json's scripts needs
# to run at install time now that wpackagist-plugin/meta-box (the one
# dependency that did) has been removed — see App\Providers\
# CecfContentServiceProvider's docblock.
#
# mkdir web/app/plugins: with zero `wordpress-plugin`-type Composer
# dependencies left (meta-box was the only one), composer/installers
# never creates that directory at all — but the runtime stage below
# still COPYs it (mirroring how every other Composer-managed dir is
# copied, and ready for the day a real plugin dependency comes back), so
# it needs to exist even empty.
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts \
    && mkdir -p web/app/plugins

WORKDIR /app/web/app/themes/cecf-sage
COPY services/cecf-wordpress/web/app/themes/cecf-sage/composer.json \
     services/cecf-wordpress/web/app/themes/cecf-sage/composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts

# ── Stage 3: runtime — nginx + php-fpm in one container ──
# (One Render service, one billed instance — every network subsite is
#  served from here; separation between sites is at the DB table level.)
FROM php:8.4-fpm-alpine AS runtime

# gd is required for WordPress's built-in image editor (WP_Image_Editor_GD)
# — without it OR Imagick, every crop/resize/thumbnail-regeneration call
# fails ("There has been an error cropping your image."). Runtime libs are
# installed as their own layer, before the -dev/build-only virtual group,
# so `apk del .build-deps` can't accidentally take them out as orphaned
# transitive dependencies.
RUN apk add --no-cache nginx supervisor mysql-client bash curl \
        libpng libjpeg-turbo freetype libwebp \
    && apk add --no-cache --virtual .build-deps \
        $PHPIZE_DEPS libpng-dev libjpeg-turbo-dev freetype-dev libwebp-dev \
    && docker-php-ext-configure gd --with-jpeg --with-freetype --with-webp \
    && docker-php-ext-install pdo_mysql mysqli opcache gd \
    && pecl install redis && docker-php-ext-enable redis \
    && curl -sSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
    && chmod +x /usr/local/bin/wp \
    && apk del .build-deps

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
#
# Acorn's storage_path() defaults to <theme>/storage (no LARAVEL_STORAGE_PATH
# override is set anywhere here), and nothing in composer/roots-acorn ships
# that directory — it has to be created explicitly, or every view render
# throws (Illuminate\Filesystem::put()'s tempnam() call fails when its
# target dir doesn't exist, surfacing as a 500 on literally every page).
RUN mkdir -p web/app/uploads \
    web/app/themes/cecf-sage/storage/framework/cache/data \
    web/app/themes/cecf-sage/storage/framework/sessions \
    web/app/themes/cecf-sage/storage/framework/testing \
    web/app/themes/cecf-sage/storage/framework/views \
    web/app/themes/cecf-sage/storage/logs \
    && chown -R www-data:www-data web/app

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
