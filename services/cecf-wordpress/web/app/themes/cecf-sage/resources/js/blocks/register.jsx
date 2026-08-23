/**
 * Registers one Gutenberg block per entry in `window.cecfSectionSchema`
 * (localized by App\Providers\CecfBlocksServiceProvider from
 * App\Content\SectionFields — the single source of truth for what fields
 * each `SectionTypes` value has). There is no hand-written block per
 * section type: `edit()` is the same generic component for all ~20,
 * pointed at a different field list each time.
 *
 * Editing model: the canvas shows the block's real, styled front-end
 * markup live via <ServerSideRender> (the exact same
 * partials/cecf/<type>.blade.php partial the public site renders,
 * through the block's own `render_callback`); every editable field lives
 * in the Inspector sidebar (resources/js/blocks/fields.jsx), so a
 * Content Manager sees what they're building while they build it, the
 * same as any other WordPress block — not a raw JSON textarea.
 */
import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { PanelBody } from '@wordpress/components';
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
    const blockProps = useBlockProps();
    const data = attributes.data || {};

    return (
      <>
        <InspectorControls>
          <PanelBody title={__('Section content', 'cecf-sage')} initialOpen>
            <SectionForm
              fields={fields}
              data={data}
              onChange={(next) => setAttributes({ data: next })}
            />
          </PanelBody>
        </InspectorControls>
        <div {...blockProps}>
          {fields.length === 0 ? (
            <p className="cecf-block-empty">{label}</p>
          ) : (
            <ServerSideRender block={name} attributes={attributes} />
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
