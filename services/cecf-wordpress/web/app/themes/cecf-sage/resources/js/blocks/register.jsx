/**
 * Registers one Gutenberg block per entry in `window.cecfSectionSchema`
 * (localized by App\Providers\CecfBlocksServiceProvider from
 * App\Content\SectionFields — the single source of truth for what fields
 * each `SectionTypes` value has).
 *
 * Two editing models, picked per type:
 *  - `resources/js/blocks/layouts.jsx`'s WYSIWYG_LAYOUTS: hand-authored,
 *    for the highest-traffic types (phead, cardGrid, ctaBand, callout,
 *    note, statGrid so far). Reproduces that type's own
 *    partials/cecf/<type>.blade.php markup/classes directly in the
 *    canvas with <RichText> in place of each text field — click the
 *    heading/body text where it will appear and type, the same as every
 *    core WordPress block.
 *  - Every other type: the generic SectionForm (resources/js/blocks/
 *    fields.jsx) — one labelled field per schema entry, still full-width
 *    in the canvas (not the ~280px Inspector sidebar, unusable once a
 *    section nests repeaters inside repeaters), just not inline WYSIWYG
 *    yet. Extend WYSIWYG_LAYOUTS with more types over time; nothing here
 *    depends on which types have one.
 *
 * Both share the same toolbar Edit/Preview toggle — Preview renders the
 * block's real, styled front-end markup via <ServerSideRender> (the same
 * partials/cecf/<type>.blade.php partial the public site renders,
 * through the block's own render_callback), useful even for a WYSIWYG
 * layout to check things it doesn't reproduce inline (e.g. icon glyphs).
 */
import { registerBlockType } from '@wordpress/blocks';
import { BlockControls, useBlockProps } from '@wordpress/block-editor';
import { ToolbarGroup, ToolbarButton } from '@wordpress/components';
import { useState } from '@wordpress/element';
import ServerSideRender from '@wordpress/server-side-render';
import { __ } from '@wordpress/i18n';
import { SectionForm } from './fields';
import { WYSIWYG_LAYOUTS } from './layouts';

/**
 * "twoColumn" -> "two-column" — must match App\Content\SectionTypes::
 * blockName()'s PHP implementation exactly, since the block name is what
 * ties this JS registration to the PHP `register_block_type()` call
 * (title/render_callback) for the same type.
 */
function blockNameFor(type) {
  const kebab = type.replace(/(?<!^)[A-Z]/g, (letter) => `-${letter}`).toLowerCase();
  return `cecf/${kebab}`;
}

/**
 * Builds the `edit()` component for one block type, closing over that
 * type's own field list/label/WYSIWYG layout (if any) rather than reading
 * them off props — every block gets its own `Edit` function, but all
 * ~20 share this one factory.
 */
function makeEdit(type, fields, label) {
  const Layout = WYSIWYG_LAYOUTS[type];

  return function Edit({ name, attributes, setAttributes }) {
    const blockProps = useBlockProps({ className: 'cecf-block' });
    const data = attributes.data || {};
    const onChange = (next) => setAttributes({ data: next });
    // Local UI state only — never serialized into post_content, unlike
    // `data` above. Starts on "edit": a Content Manager opens a block to
    // change its content far more often than to just look at it, and the
    // canvas already showed a live preview before any edit happened
    // (ServerSideRender re-renders on every keystroke regardless of which
    // tab is active once they've made a change and switched over).
    const [view, setView] = useState('edit');

    return (
      <>
        <BlockControls>
          <ToolbarGroup>
            <ToolbarButton
              isPressed={view === 'edit'}
              onClick={() => setView('edit')}
            >
              {__('Edit', 'cecf-sage')}
            </ToolbarButton>
            <ToolbarButton
              isPressed={view === 'preview'}
              onClick={() => setView('preview')}
            >
              {__('Preview', 'cecf-sage')}
            </ToolbarButton>
          </ToolbarGroup>
        </BlockControls>
        <div {...blockProps}>
          {fields.length === 0 ? (
            <p className="cecf-block-empty">{label}</p>
          ) : view === 'preview' ? (
            <ServerSideRender block={name} attributes={attributes} />
          ) : Layout ? (
            <Layout data={data} onChange={onChange} />
          ) : (
            <div className="cecf-block-form">
              <p className="cecf-block-form__label">{label}</p>
              <SectionForm
                fields={fields}
                data={data}
                onChange={onChange}
              />
            </div>
          )}
        </div>
      </>
    );
  };
}

export function registerCecfBlocks() {
  const schema = window.cecfSectionSchema || {};
  const labels = window.cecfSectionLabels || {};
  const category = window.cecfBlockCategory || 'cecf-sections';

  Object.entries(schema).forEach(([type, fields]) => {
    const label = labels[type] || type;

    registerBlockType(blockNameFor(type), {
      apiVersion: 3,
      title: label,
      category,
      icon: 'layout',
      attributes: {
        data: { type: 'object', default: {} },
      },
      supports: {
        html: false,
        anchor: false,
      },
      edit: makeEdit(type, fields, label),
      save: () => null,
    });
  });
}
