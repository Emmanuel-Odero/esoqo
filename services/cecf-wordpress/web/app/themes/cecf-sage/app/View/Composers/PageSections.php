<?php

namespace App\View\Composers;

use App\Content\SectionTypes;
use Roots\Acorn\View\Composer;

/**
 * Parses the current page's real block content (`get_the_content()`) into
 * `$cecfSections` for partials/content-page.blade.php to loop over —
 * every top-level `cecf/*` block becomes one {type, label, data} entry,
 * same shape this used to decode from the old "cecf_sections" Meta Box
 * field. That's what keeps every partials/cecf/*.blade.php file (and the
 * App\Support\* helpers they call) completely unchanged by the move to
 * blocks: only where `$data` comes from changed, not its shape.
 *
 * This is the only place in the theme that reads block content directly
 * — matching App\Providers\CecfBlocksServiceProvider's role on the
 * editing side, one reader, not one per view.
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
        $blocks = parse_blocks((string) get_the_content());
        $sections = [];

        foreach ($blocks as $block) {
            $type = SectionTypes::typeFromBlockName((string) ($block['blockName'] ?? ''));

            if ($type === null) {
                continue; // not a cecf/* section block — e.g. an editor left a note in a core/paragraph block
            }

            $data = $block['attrs']['data'] ?? [];

            $sections[] = [
                'type' => $type,
                'label' => SectionTypes::options()[$type] ?? $type,
                'data' => is_array($data) ? $data : [],
            ];
        }

        return $sections;
    }
}
