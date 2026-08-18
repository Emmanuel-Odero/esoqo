#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

# ── Required env vars ────────────────────────────────────────────
# We ship no .env file (Bedrock skips its own dotenv->required() check
# when one isn't present, relying on injected process env instead), so
# enforce the same guarantee here rather than fail deep inside wp-cli
# with a confusing "You must provide a domain name" error.
for var in WP_HOME WP_SITEURL DB_HOST DB_NAME DB_USER DB_PASSWORD; do
    if [ -z "$(eval echo \$$var)" ]; then
        echo "Required env var ${var} is not set, exiting." >&2
        exit 1
    fi
done

# ── Bind nginx to Render's assigned port (defaults to 8080 locally) ──
: "${PORT:=8080}"
sed -i "s/__PORT__/${PORT}/" /etc/nginx/nginx.conf

# ── Wait for MySQL (cecf-mariadb) ───────────────────────────────
: "${DB_HOST:=cecf-mariadb}"
: "${DB_PORT:=3306}"
echo "Waiting for MySQL at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 30); do
    if mysqladmin ping -h "$DB_HOST" -P "$DB_PORT" --silent 2>/dev/null; then
        echo "MySQL is up."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "MySQL never became reachable, exiting." >&2
        exit 1
    fi
    sleep 2
done

# ── Bootstrap the network on first boot only ────────────────────
# Runs as www-data so file ownership on anything WP writes (uploads,
# .maintenance, etc.) matches what php-fpm/nginx run as.
if ! su -s /bin/bash www-data -c "wp core is-installed" 2>/dev/null; then
    echo "No install detected — running multisite-install for ${WP_HOME:-unset}."
    su -s /bin/bash www-data -c "wp core multisite-install \
        --url='${WP_HOME}' \
        --title='Child Elder Care Foundation' \
        --admin_user='${WP_ADMIN_USER:-cecf-admin}' \
        --admin_password='${WP_ADMIN_PASSWORD:?WP_ADMIN_PASSWORD must be set for first boot}' \
        --admin_email='${WP_ADMIN_EMAIL:?WP_ADMIN_EMAIL must be set for first boot}' \
        --subdomains \
        --skip-email"
    su -s /bin/bash www-data -c "wp theme activate cecf-sage"

    # Required for every page to render anything at all — App\View\
    # Composers\PageSections guards on function_exists('rwmb_meta') and
    # silently returns an empty section list otherwise, so a page with
    # no active Meta Box renders a real, seeded page with a genuinely
    # empty <main>, not an error. --network because this is a subdomain
    # multisite install (MULTISITE_SUBDOMAIN) — a plain `wp plugin
    # activate` only activates for the current site, not every subsite.
    su -s /bin/bash www-data -c "wp plugin activate meta-box --network"

    # `wp core multisite-install --url=` sets both the `home` and
    # `siteurl` options to that one URL — fine for a non-Bedrock install
    # where WordPress core lives at the site root, wrong here, where core
    # lives under /wp (CONTENT_DIR in config/application.php). Confirmed
    # empirically: WP_HOME/WP_SITEURL being defined as PHP constants does
    # NOT make WordPress core override the stored `home`/`siteurl`
    # options at runtime (no such pre_option_home/siteurl filter exists
    # in core) — every home_url()/get_permalink() call would otherwise
    # carry a wrong "/wp" prefix on every link on the site. Idempotent,
    # only runs on first boot alongside the install itself.
    su -s /bin/bash www-data -c "wp option update home '${WP_HOME}'"
    su -s /bin/bash www-data -c "wp option update siteurl '${WP_SITEURL}'"
else
    echo "Existing install detected — skipping install, running migrations only."
    su -s /bin/bash www-data -c "wp core update-db --network"
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
