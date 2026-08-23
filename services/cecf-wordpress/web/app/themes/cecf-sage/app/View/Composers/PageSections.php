<?php

namespace App\View\Composers;

use App\Content\SectionTypes;
use App\Customizer\CecfSectionSetting;
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
        $postId = (int) get_the_ID();
        $blocks = parse_blocks((string) get_the_content());
        $sections = [];
        $index = -1;

        foreach ($blocks as $block) {
            $type = SectionTypes::typeFromBlockName((string) ($block['blockName'] ?? ''));

            if ($type === null) {
                continue; // not a cecf/* section block — e.g. an editor left a note in a core/paragraph block
            }

            $index++;
            $data = $block['attrs']['data'] ?? [];

            // While previewing an unpublished Customizer changeset (see
            // App\Providers\CecfPageEditorServiceProvider/App\Customizer\
            // CecfSectionSetting), a section's edited-but-unsaved value
            // lives there instead of in $data above — same "changeset
            // isn't real until Publish, but the preview iframe reflects
            // it immediately" behaviour core's own theme_mod/option
            // setting types get for free, reimplemented here since
            // per-block page content is neither.
            if (is_customize_preview()) {
                $preview = CecfSectionSetting::previewedValue($postId, $index);
                if ($preview !== null) {
                    $data = $preview;
                }
            }

            $sections[] = [
                'type' => $type,
                'label' => SectionTypes::options()[$type] ?? $type,
                'data' => is_array($data) ? $data : [],
            ];
        }

        return $sections;
    }
}
