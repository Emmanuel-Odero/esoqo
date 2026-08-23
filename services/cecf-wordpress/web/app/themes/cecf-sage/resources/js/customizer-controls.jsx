/**
 * Runs in the Customizer's admin control-panel frame (registered via
 * customize_controls_enqueue_scripts, see App\Providers\
 * CecfPageEditorServiceProvider) — mounts the *same* `<SectionForm>`
 * (resources/js/blocks/fields.jsx) the block editor's canvas form
 * renders for a `cecf/<type>` block, one instance per `cecf_section`
 * control (App\Customizer\CecfSectionControl), bound to that control's
 * `wp.customize` setting instead of a block's `setAttributes`. Reusing
 * the component rather than reimplementing it is what keeps "edit this
 * page's content from the Customizer" and "edit it from the block
 * editor" behaving identically — same fields, same repeater/reorder
 * behaviour, same page/icon pickers — not two editors that happen to
 * look similar.
 *
 * Two responsibilities beyond mounting the form:
 *  - Every edit calls `setting.set(next)`, which WordPress's own
 *    Customizer JS already debounces into the live preview iframe
 *    refreshing with the pending (unsaved) changeset applied — see
 *    App\Customizer\CecfSectionSetting::preview() for the PHP half of
 *    that (a custom setting `type` gets no such preview behaviour for
 *    free the way core's theme_mod/option types do).
 *  - Each page's Customizer panel points the preview iframe at that
 *    page's own URL when expanded — without this, the iframe stays on
 *    whatever page it last showed while you edit a different page's
 *    settings, which would make "live preview" show the wrong page.
 */
import { createRoot } from '@wordpress/element';
import { SectionForm } from './blocks/fields';

function mount(control) {
  const container = control.container?.[0] || control.container;
  const el = container?.querySelector('.cecf-customize-section');
  if (! el) {
    return;
  }

  const settingId = el.getAttribute('data-cecf-setting');
  const type = el.getAttribute('data-cecf-type');
  const setting = window.wp.customize(settingId);
  const schema = (window.cecfSectionSchema || {})[type] || [];

  const root = createRoot(el);

  const render = () => {
    root.render(
      <SectionForm
        fields={schema}
        data={setting.get() || {}}
        onChange={(next) => setting.set(next)}
      />,
    );
  };

  render();

  // Reflect a Reset (or any other external change to this setting —
  // e.g. a second browser tab on the same changeset) back into the form.
  setting.bind(render);
}

function mountEach(customize) {
  customize.control.each((control) => {
    if (control.params.type === 'cecf_section') {
      control.deferred.embedded.done(() => mount(control));
    }
  });

  customize.control.bind('add', (control) => {
    if (control.params.type === 'cecf_section') {
      control.deferred.embedded.done(() => mount(control));
    }
  });
}

/**
 * `window.cecfPagePanelUrls` (panel ID -> that page's front-end URL) is
 * localized by App\Providers\CecfPageEditorServiceProvider alongside the
 * panels themselves — simpler than threading the URL through a custom
 * `WP_Customize_Panel` subclass's own JS template just to read it back
 * off the DOM.
 */
function bindPreviewNavigation(customize) {
  const urls = window.cecfPagePanelUrls || {};

  customize.panel.each((panel) => {
    const url = urls[panel.id];
    if (! url) {
      return;
    }

    panel.expanded.bind((isExpanded) => {
      if (isExpanded) {
        customize.previewer.previewUrl.set(url);
      }
    });
  });
}

window.wp.customize.bind('ready', () => {
  mountEach(window.wp.customize);
  bindPreviewNavigation(window.wp.customize);
});
