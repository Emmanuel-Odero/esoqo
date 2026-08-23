/**
 * Registers one Gutenberg block per entry in `window.cecfSectionSchema`
 * (localized by App\Providers\CecfBlocksServiceProvider from
 * App\Content\SectionFields — the single source of truth for what fields
 * each `SectionTypes` value has). There is no hand-written block per
 * section type: `edit()` is the same generic component for all ~20,
 * pointed at a different field list each time.
 *
 * Editing model: every field (resources/js/blocks/fields.jsx) renders
 * full-width in the canvas itself, not the Inspector sidebar — a ~280px
 * sidebar is workable for one or two plain-text fields, but this theme's
 * blocks nest repeaters inside repeaters (cardGrid's items, each with an
 * icon/color/title/body; ctaBand's ctas; table rows), which turns
 * unusable once squeezed that narrow. A toolbar toggle switches the
 * canvas between that edit form and the block's real, styled front-end
 * markup via <ServerSideRender> (the same partials/cecf/<type>.blade.php
 * partial the public site renders, through the block's own
 * render_callback) — so a Content Manager can check how it looks without
 * permanently losing the width to edit in.
 */
import { registerBlockType } from '@wordpress/blocks';
import { BlockControls, useBlockProps } from '@wordpress/block-editor';
import { ToolbarGroup, ToolbarButton } from '@wordpress/components';
import { useState } from '@wordpress/element';
import ServerSideRender from '@wordpress/server-side-render';
import { __ } from '@wordpress/i18n';
import { SectionForm } from './fields';

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
 * type's own field list/label rather than reading them off props — every
 * block gets its own `Edit` function, but all ~20 share this one factory.
 */
function makeEdit(fields, label) {
  return function Edit({ name, attributes, setAttributes }) {
    const blockProps = useBlockProps({ className: 'cecf-block' });
    const data = attributes.data || {};
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
          ) : (
            <div className="cecf-block-form">
              <p className="cecf-block-form__label">{label}</p>
              <SectionForm
                fields={fields}
                data={data}
                onChange={(next) => setAttributes({ data: next })}
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
      edit: makeEdit(fields, label),
      save: () => null,
    });
  });
}
