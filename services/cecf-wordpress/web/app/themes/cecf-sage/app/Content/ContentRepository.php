<?php

namespace App\Content;

use RuntimeException;

/**
 * Read-only access to the seed content under database/content/.
 *
 * Deliberately the *only* thing in this theme that knows the JSON files'
 * shape and location. Every seeder in database/seeders/ goes through this
 * class instead of calling file_get_contents()/json_decode() itself, so
 * there is exactly one place that breaks if the content folder ever moves
 * or the schema changes — not four.
 *
 * This class does no WordPress writes and only one WordPress read
 * (get_theme_file_path(), for locating the theme root); it is safe to
 * unit test without a WP bootstrap by constructing it with an explicit
 * $basePath.
 */
class ContentRepository
{
    protected string $basePath;

    public function __construct(?string $basePath = null)
    {
        $this->basePath = $basePath ?? $this->defaultBasePath();
    }

    /**
     * The registry of all pages: key, slug, title, kicker, isHome, etc.
     *
     * @return array{pages: array<int, array<string, mixed>>, note?: string}
     */
    public function pageIndex(): array
    {
        return $this->readJson('pages/_index.json');
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function pages(): array
    {
        return $this->pageIndex()['pages'] ?? [];
    }

    /**
     * A single page's registry entry (slug, title, kicker, …) by its stable key.
     */
    public function pageMeta(string $key): ?array
    {
        foreach ($this->pages() as $page) {
            if (($page['key'] ?? null) === $key) {
                return $page;
            }
        }

        return null;
    }

    /**
     * A single page's ordered section list — pages/<key>.json.
     *
     * @return array{sections: array<int, array<string, mixed>>, note?: string}
     */
    public function page(string $key): array
    {
        return $this->readJson("pages/{$key}.json");
    }

    /**
     * @return array<string, mixed>
     */
    public function navigation(): array
    {
        return $this->readJson('navigation.json');
    }

    /**
     * @return array<string, mixed>
     */
    public function siteSettings(): array
    {
        return $this->readJson('site-settings.json');
    }

    /**
     * Absolute paths to every deduped illustration SVG, keyed by filename
     * (e.g. "community-gathering.svg" => "/…/media/illustrations/community-gathering.svg").
     *
     * @return array<string, string>
     */
    public function illustrations(): array
    {
        $dir = "{$this->basePath}/media/illustrations";

        if (! is_dir($dir)) {
            return [];
        }

        $files = glob("{$dir}/*.svg") ?: [];

        $illustrations = [];
        foreach ($files as $path) {
            $illustrations[basename($path)] = $path;
        }

        return $illustrations;
    }

    protected function readJson(string $relativePath): array
    {
        $path = "{$this->basePath}/{$relativePath}";

        if (! is_file($path)) {
            throw new RuntimeException("CECF content file not found: {$path}");
        }

        $contents = file_get_contents($path);
        $decoded = json_decode($contents, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException(
                "CECF content file is not valid JSON: {$path} — ".json_last_error_msg()
            );
        }

        return $decoded;
    }

    protected function defaultBasePath(): string
    {
        $themeRoot = function_exists('get_theme_file_path')
            ? get_theme_file_path()
            : dirname(__DIR__, 2);

        return rtrim($themeRoot, '/').'/database/content';
    }
}
