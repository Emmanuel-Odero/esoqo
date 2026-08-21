<?php

/**
 * Your base production configuration goes in this file. Environment-specific
 * overrides go in their respective config/environments/{{WP_ENV}}.php file.
 *
 * A good default policy is to deviate from the production config as little as
 * possible. Try to define as much of your configuration in this file as you
 * can.
 */

use Roots\WPConfig\Config;

use function Env\env;

// CONVERT_* + STRIP_QUOTES + LOCAL_FIRST
Env\Env::$options
    = Env\Env::CONVERT_BOOL
    | Env\Env::CONVERT_NULL
    | Env\Env::CONVERT_INT
    | Env\Env::STRIP_QUOTES
    | Env\Env::LOCAL_FIRST;

/**
 * Directory containing all of the site's files
 *
 * @var string
 */
$root_dir = dirname(__DIR__);

/**
 * Document Root
 *
 * @var non-falsy-string
 */
$webroot_dir = $root_dir . '/web';

/**
 * Use Dotenv to set required environment variables and load .env file in root
 * .env.local will override .env if it exists
 */
if (file_exists($root_dir . '/.env')) {
    $env_files = file_exists($root_dir . '/.env.local')
        ? ['.env', '.env.local']
        : ['.env'];

    $repository = Dotenv\Repository\RepositoryBuilder::createWithNoAdapters()
        ->addAdapter(Dotenv\Repository\Adapter\EnvConstAdapter::class)
        ->addAdapter(Dotenv\Repository\Adapter\PutenvAdapter::class)
        ->immutable()
        ->make();

    $dotenv = Dotenv\Dotenv::create($repository, $root_dir, $env_files, false);
    $dotenv->load();

    $dotenv->required(['WP_HOME', 'WP_SITEURL']);
    if (!env('DATABASE_URL')) {
        $dotenv->required(['DB_NAME', 'DB_USER', 'DB_PASSWORD']);
    }
}

/**
 * Set up our global environment constant and load its config first
 * Default: production
 */
define('WP_ENV', env('WP_ENV') ?: 'production');

/**
 * Set WP_ENVIRONMENT_TYPE if not already defined
 */
if (!defined('WP_ENVIRONMENT_TYPE')) {
    $wp_environment_type = env('WP_ENVIRONMENT_TYPE');

    if ($wp_environment_type) {
        Config::define('WP_ENVIRONMENT_TYPE', $wp_environment_type);
    } elseif (in_array(WP_ENV, ['production', 'staging', 'development', 'local'], true)) {
        Config::define('WP_ENVIRONMENT_TYPE', WP_ENV);
    }
}

/**
 * Set WP_DEVELOPMENT_MODE if explicitly configured
 */
if (!defined('WP_DEVELOPMENT_MODE')) {
    $wp_development_mode = env('WP_DEVELOPMENT_MODE');

    if ($wp_development_mode) {
        Config::define('WP_DEVELOPMENT_MODE', $wp_development_mode);
    }
}

/**
 * URLs
 */
Config::define('WP_HOME', env('WP_HOME'));
Config::define('WP_SITEURL', env('WP_SITEURL'));

/**
 * Custom Content Directory
 */
Config::define('CONTENT_DIR', '/app');
Config::define('WP_CONTENT_DIR', $webroot_dir . Config::get('CONTENT_DIR'));
Config::define('WP_CONTENT_URL', Config::get('WP_HOME') . Config::get('CONTENT_DIR'));

/**
 * DB settings
 */
if (env('DB_SSL')) {
    Config::define('MYSQL_CLIENT_FLAGS', MYSQLI_CLIENT_SSL);
}

Config::define('DB_NAME', env('DB_NAME'));
Config::define('DB_USER', env('DB_USER'));
Config::define('DB_PASSWORD', env('DB_PASSWORD'));
Config::define('DB_HOST', env('DB_HOST') ?: 'localhost');
Config::define('DB_CHARSET', 'utf8mb4');
Config::define('DB_COLLATE', '');
$table_prefix = env('DB_PREFIX') ?: 'wp_';

if (env('DATABASE_URL')) {
    $dsn = (object) parse_url(env('DATABASE_URL'));

    Config::define('DB_NAME', substr($dsn->path, 1));
    Config::define('DB_USER', $dsn->user);
    Config::define('DB_PASSWORD', isset($dsn->pass) ? $dsn->pass : null);
    Config::define('DB_HOST', isset($dsn->port) ? "{$dsn->host}:{$dsn->port}" : $dsn->host);
}

/**
 * Authentication Unique Keys and Salts
 */
Config::define('AUTH_KEY', env('AUTH_KEY'));
Config::define('SECURE_AUTH_KEY', env('SECURE_AUTH_KEY'));
Config::define('LOGGED_IN_KEY', env('LOGGED_IN_KEY'));
Config::define('NONCE_KEY', env('NONCE_KEY'));
Config::define('AUTH_SALT', env('AUTH_SALT'));
Config::define('SECURE_AUTH_SALT', env('SECURE_AUTH_SALT'));
Config::define('LOGGED_IN_SALT', env('LOGGED_IN_SALT'));
Config::define('NONCE_SALT', env('NONCE_SALT'));

/**
 * Custom Settings
 */
Config::define('AUTOMATIC_UPDATER_DISABLED', true);
Config::define('DISABLE_WP_CRON', env('DISABLE_WP_CRON') ?: false);

// Disable the plugin and theme file editor in the admin
Config::define('DISALLOW_FILE_EDIT', true);

// Disable plugin and theme updates and installation from the admin
Config::define('DISALLOW_FILE_MODS', true);

// Limit the number of post revisions
Config::define('WP_POST_REVISIONS', env('WP_POST_REVISIONS') ?? true);

// Disable script concatenation
Config::define('CONCATENATE_SCRIPTS', false);

/**
 * Media storage — Cloudflare R2, same account/bucket-naming scheme as
 * the rest of esoko (see packages/db/src/storage.ts's own header for
 * the sibling Node-side config). Backed by humanmade/s3-uploads
 * (web/app/plugins/s3-uploads, composer.json) — its stream wrapper
 * makes every core upload path (wp_handle_upload, thumbnail/srcset
 * generation, the media library) write straight to R2 with no plugin
 * code of ours involved; web/app/mu-plugins/media-policy.php is what
 * restricts *which* files are accepted and how they're compressed
 * before that happens.
 *
 * Only defined when R2 credentials are present — same "dev stays local
 * unless configured otherwise" rule as STORAGE_PROVIDER on the Node
 * side. Local development with no R2_* vars set falls straight through
 * to WordPress's own default (wp-content/uploads on local disk); the
 * plugin is only ever network-activated (docker/entrypoint.sh) when
 * this block actually ran.
 */
if (env('R2_ACCOUNT_ID')) {
    Config::define('S3_UPLOADS_BUCKET', env('R2_BUCKET') ?: 'cecf-media');
    Config::define('S3_UPLOADS_KEY', env('R2_ACCESS_KEY_ID'));
    Config::define('S3_UPLOADS_SECRET', env('R2_SECRET_ACCESS_KEY'));
    // R2's own documented value, not a real AWS region — required by
    // the plugin (it wp_die()s without one) and by the SDK's SigV4
    // signing, but R2 itself only recognises 'auto'.
    Config::define('S3_UPLOADS_REGION', 'auto');
    // R2_PUBLIC_URL is the bucket's public-read origin (an r2.dev
    // subdomain, or a custom domain mapped to the bucket in the
    // Cloudflare dashboard) — deliberately NOT the same private-proxy
    // pattern apps/jamii's /img route uses. WordPress media (blog
    // photos, PDFs linked from posts) is public content by nature;
    // there is no equivalent "opaque storage key never exposed"
    // requirement here the way there is for a group's page assets.
    if (env('R2_PUBLIC_URL')) {
        Config::define('S3_UPLOADS_BUCKET_URL', env('R2_PUBLIC_URL'));
    }
}

// Cloudflare R2's S3-compatible endpoint is account-scoped, not a real
// AWS region endpoint — the plugin has no built-in constant for this,
// so it's supplied through its own documented `s3_uploads_s3_client_params`
// filter instead of forking the plugin. That filter is registered in
// web/app/mu-plugins/media-policy.php, not here: add_filter() doesn't
// exist yet at this point in the load order (this file runs before
// WordPress's plugin API is bootstrapped) — only Config::define() calls
// belong in application.php.

/**
 * Debugging Settings
 */
Config::define('WP_DEBUG_DISPLAY', false);
Config::define('WP_DEBUG_LOG', false);
Config::define('SCRIPT_DEBUG', false);
ini_set('display_errors', '0');

/**
 * Allow WordPress to detect HTTPS when used behind a reverse proxy or a load balancer
 * See https://codex.wordpress.org/Function_Reference/is_ssl#Notes
 */
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}

/**
 * Multisite (CECF network)
 *
 * Subdomain multisite: one Bedrock codebase + one shared database serve
 * every CECF property (childeldercare.foundation, donate.*, blog.*, ...)
 * as blogs in the network, each keyed off wildcard DNS + $_SERVER['HTTP_HOST'].
 * Toggle off (MULTISITE_ENABLED=false) for local single-site development.
 */
if (env('MULTISITE_ENABLED')) {
    Config::define('WP_ALLOW_MULTISITE', true);
    Config::define('MULTISITE', true);
    Config::define('SUBDOMAIN_INSTALL', (bool) env('MULTISITE_SUBDOMAIN'));
    Config::define('DOMAIN_CURRENT_SITE', env('MULTISITE_DOMAIN'));
    Config::define('PATH_CURRENT_SITE', env('MULTISITE_PATH') ?: '/');
    Config::define('SITE_ID_CURRENT_SITE', (int) (env('MULTISITE_SITE_ID') ?: 1));
    Config::define('BLOG_ID_CURRENT_SITE', (int) (env('MULTISITE_BLOG_ID') ?: 1));

    // Network sites almost never live at the domain's own port; cookies
    // must be scoped to the parent domain so login/session cross subsites.
    Config::define('COOKIE_DOMAIN', '.' . env('MULTISITE_DOMAIN'));
}

$env_config = __DIR__ . '/environments/' . WP_ENV . '.php';

if (file_exists($env_config)) {
    require_once $env_config;
}

Config::apply();

/**
 * Bootstrap WordPress
 */
if (!defined('ABSPATH')) {
    define('ABSPATH', $webroot_dir . '/wp/');
}
