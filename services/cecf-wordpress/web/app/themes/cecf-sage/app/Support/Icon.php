<?php

namespace App\Support;

/**
 * Reads the small icon set at resources/images/icons/*.svg by name. These
 * are theme build assets, not seed content — see database/content/media/
 * icons/README.md for why icon markup isn't stored in the database:
 * restyling an icon should be a theme-code change, not a content edit, and
 * the same handful of icons are referenced by name from dozens of section
 * JSON payloads (e.g. `"icon": "document"` in cardGrid items) rather than
 * duplicated as inline SVG per instance.
 *
 * Used via the <x-icon name="document" /> Blade component
 * (resources/views/components/icon.blade.php), not called directly from
 * views.
 */
class Icon
{
    /** @var array<string, string> in-request cache, filename => raw contents */
    protected static array $cache = [];

    public static function svg(string $name, int $size = 20): string
    {
        $name = basename($name); // never let a section's `icon` value escape the icons/ folder

        if (! isset(self::$cache[$name])) {
            $path = self::path($name);

            self::$cache[$name] = is_file($path) ? file_get_contents($path) : '';
        }

        $svg = self::$cache[$name];

        if ($svg === '') {
            return '';
        }

        // Negative lookbehind excludes stroke-width="…" — a plain
        // "width=" match would corrupt it too, since "stroke-width"
        // contains "width" as a substring.
        return preg_replace(
            ['/(?<!stroke-)width="[\d.]+"/', '/(?<!stroke-)height="[\d.]+"/'],
            ["width=\"{$size}\"", "height=\"{$size}\""],
            $svg,
            1
        );
    }

    public static function exists(string $name): bool
    {
        return is_file(self::path(basename($name)));
    }

    /**
     * svg() plus a `class` attribute — shared by the <x-icon> Blade
     * component and App\Support\Nav\CecfMenuWalker (which can't use a
     * Blade component from inside a Walker_Nav_Menu callback) so the
     * class-injection logic lives in exactly one place.
     *
     * @param  list<string>  $classes
     */
    public static function tag(string $name, array $classes = [], int $size = 20): string
    {
        $svg = self::svg($name, $size);

        if ($svg === '') {
            return '';
        }

        $class = trim(implode(' ', array_merge(['ic'], $classes)));

        return str_replace('<svg ', '<svg class="'.$class.'" ', $svg);
    }

    protected static function path(string $name): string
    {
        $themeRoot = function_exists('get_theme_file_path')
            ? get_theme_file_path()
            : dirname(__DIR__, 2);

        return rtrim($themeRoot, '/')."/resources/images/icons/{$name}.svg";
    }
}
