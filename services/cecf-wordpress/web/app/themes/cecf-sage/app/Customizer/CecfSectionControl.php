<?php

namespace App\Customizer;

use WP_Customize_Control;

/**
 * Renders one mount point for resources/js/customizer-controls.js to
 * hydrate — no default WP_Customize_Control markup (no label/description
 * `<span>`s, no single `<input>`), since what goes here is the *same*
 * schema-driven `<SectionForm>` (resources/js/blocks/fields.jsx) the
 * block editor's canvas form already uses for this exact section type,
 * mounted by JS rather than rendered by PHP — this class only has to get
 * that JS the two things it can't know on its own: which setting ID owns
 * this section, and which `SectionTypes` value it is (so the JS side
 * knows which field list, out of `window.cecfSectionSchema`, to render).
 */
class CecfSectionControl extends WP_Customize_Control
{
    public $type = 'cecf_section';

    protected string $sectionType;

    public function __construct($manager, $id, $args, string $sectionType)
    {
        $this->sectionType = $sectionType;

        parent::__construct($manager, $id, $args);
    }

    public function render_content(): void
    {
        printf(
            '<div class="cecf-customize-section" data-cecf-setting="%s" data-cecf-type="%s"></div>',
            esc_attr($this->settings['default']->id),
            esc_attr($this->sectionType),
        );
    }

    // No enqueue() override: the window.cecfSectionSchema/etc. globals
    // resources/js/customizer-controls.jsx (and, through it,
    // resources/js/blocks/fields.jsx) reads are localized once for the
    // whole Customizer screen by App\Providers\
    // CecfPageEditorServiceProvider::enqueueControls() instead of once
    // per control here — see that method's own comment for why
    // wp_add_inline_script() (the obvious per-control approach) doesn't
    // actually work in this context.
}
