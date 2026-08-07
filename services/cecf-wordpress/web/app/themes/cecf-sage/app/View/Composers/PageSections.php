<?php

namespace App\View\Composers;

use Roots\Acorn\View\Composer;

/**
 * Decodes the `cecf_sections` Meta Box field (registered in
 * App\Providers\CecfContentServiceProvider, seeded by database/seeders/
 * PageSeeder.php) into `$cecfSections` for partials/content-page.blade.php
 * to loop over. This is the only place in the theme that reads that field
 * directly — matching App\Content\ContentRepository's role on the seeding
 * side, one reader, not one per view.
 */
class PageSections extends Composer
{
    protected static $views = [
        'partials.content-page',
    ];

    public function with()
    {
        return [
            'cecfSections' => $this->sections(),
        ];
    }

    /**
     * @return array<int, array{type: string, label: string, data: array<string, mixed>}>
     */
    protected function sections(): array
    {
        if (! function_exists('rwmb_meta')) {
            return [];
        }

        $rows = rwmb_meta('cecf_sections', [], get_the_ID());
        $sections = [];

        foreach ((array) $rows as $row) {
            $data = json_decode($row['data'] ?? '', true);

            if (! is_array($data)) {
                continue; // malformed row — skip rather than break the whole page
            }

            $sections[] = [
                'type' => $row['type'] ?? '',
                'label' => $row['label'] ?? '',
                'data' => $data,
            ];
        }

        return $sections;
    }
}
