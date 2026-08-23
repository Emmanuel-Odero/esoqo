/**
 * Hand-authored, WYSIWYG canvas layouts for the highest-traffic `cecf/*`
 * section types — `phead`, `cardGrid`, `ctaBand`, `callout`, `note`,
 * `statGrid`. Every one of these reproduces its own
 * partials/cecf/<type>.blade.php markup/classes directly in JSX (so
 * cecf.css, already loaded into the block editor's iframe for
 * <ServerSideRender>, styles it identically) with `<RichText>` standing
 * in for each text field: click the heading/body/card text exactly where
 * it will appear on the live page and type, the same as every core
 * WordPress block — not a labelled form field bolted on beside a preview.
 *
 * This intentionally breaks from resources/js/blocks/fields.jsx's "one
 * generic renderer for every type" design: real inline WYSIWYG editing
 * needs each section type's actual visual layout, which isn't something
 * a flat field-type schema can express. register.jsx falls back to the
 * generic SectionForm (still full-width in the canvas, still a real
 * improvement over the old Inspector-sidebar form, just not inline) for
 * every section type not hand-authored here yet — the same pattern
 * extends to more types over time without touching the ones already
 * done.
 *
 * `lead`/`body`/`fineprint` fields on these six types now store real
 * HTML (RichText's native format), not the old `**bold**` markdown-lite
 * string App\Support\Markdown::inline() used to parse at render time —
 * see that migration's own note in phead.blade.php. `heading`/`kicker`/
 * `title` fields were never run through Markdown::inline() to begin with
 * (plain `{{ }}`-escaped output), so they need no such migration; a
 * RichText value with no formatting applied is just the plain string,
 * identical either way.
 */
import { RichText, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, SelectControl, TextControl, Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { pageOptions, iconOptions, selectOptions, moveItem, ReorderButtons, StringListField } from './fields';

const BOLD_ITALIC = ['core/bold', 'core/italic'];

const COLOR_OPTIONS = {
  teal: __('Teal', 'cecf-sage'),
  ochre: __('Ochre', 'cecf-sage'),
  clay: __('Clay', 'cecf-sage'),
  green: __('Green', 'cecf-sage'),
};

const BUTTON_STYLE_OPTIONS = {
  primary: __('Primary', 'cecf-sage'),
  outline: __('Outline', 'cecf-sage'),
  'outline-white': __('Outline (white)', 'cecf-sage'),
};

/**
 * Mirrors App\Support\ButtonStyle::cssClass() exactly — the same `style`
 * value -> CSS class mapping ctaBand.blade.php's real render_callback
 * output uses, so a button previewed here looks like its Preview-toggle/
 * front-end self.
 */
function buttonStyleClass(style) {
  switch (style) {
    case 'outline':
      return 'btn-o';
    case 'outline-white':
      return 'btn-w';
    default:
      return 'btn-p';
  }
}

/**
 * The small icon-button row every repeatable item below shares: reorder
 * up/down plus remove, top-right of the item. Same control set as
 * fields.jsx's generic RepeaterField, just styled to sit inside a
 * WYSIWYG card/row instead of a form <Card>'s header.
 */
function ItemControls({ index, count, onMove, onRemove }) {
  return (
    <span className="cecf-item__controls" contentEditable={false}>
      <ReorderButtons index={index} count={count} onMove={onMove} />
      <Button variant="tertiary" isDestructive size="small" onClick={onRemove}>
        {__('Remove', 'cecf-sage')}
      </Button>
    </span>
  );
}

export function PheadEdit({ data, onChange }) {
  const set = (key) => (value) => onChange({ ...data, [key]: value });

  return (
    <section className="phead cecf-wysiwyg">
      <div className="wrap">
        <RichText
          tagName="p"
          className="kick"
          placeholder={__('Kicker', 'cecf-sage')}
          value={data.kicker || ''}
          onChange={set('kicker')}
          allowedFormats={[]}
        />
        <RichText
          tagName="h1"
          placeholder={__('Heading', 'cecf-sage')}
          value={data.heading || ''}
          onChange={set('heading')}
          allowedFormats={[]}
        />
        <RichText
          tagName="p"
          className="lead"
          placeholder={__('Lead paragraph', 'cecf-sage')}
          value={data.lead || ''}
          onChange={set('lead')}
          allowedFormats={BOLD_ITALIC}
        />
      </div>
    </section>
  );
}

export function CardGridEdit({ data, onChange }) {
  const set = (key) => (value) => onChange({ ...data, [key]: value });
  const columns = data.columns || 3;
  const items = Array.isArray(data.items) ? data.items : [];
  const isMissionVision = data.variant === 'missionVision';

  const setItem = (index, patch) => {
    const copy = [...items];
    copy[index] = { ...copy[index], ...patch };
    onChange({ ...data, items: copy });
  };

  return (
    <>
      <InspectorControls>
        <PanelBody title={__('Card grid settings', 'cecf-sage')} initialOpen>
          <TextControl
            __nextHasNoMarginBottom
            label={__('Anchor ID (for in-page links)', 'cecf-sage')}
            value={data.anchor || ''}
            onChange={set('anchor')}
          />
          <SelectControl
            __nextHasNoMarginBottom
            label={__('Columns', 'cecf-sage')}
            value={String(columns)}
            options={selectOptions({ 2: '2', 3: '3', 4: '4' })}
            onChange={set('columns')}
          />
          <SelectControl
            __nextHasNoMarginBottom
            label={__('Layout', 'cecf-sage')}
            value={data.variant || ''}
            options={selectOptions({ '': 'Cards', missionVision: 'Mission / vision (no page links)' })}
            onChange={set('variant')}
          />
        </PanelBody>
      </InspectorControls>
      <section className="sec cecf-wysiwyg">
        <div className="wrap">
          <RichText tagName="p" className="kick" placeholder={__('Kicker', 'cecf-sage')} value={data.kicker || ''} onChange={set('kicker')} allowedFormats={[]} />
          <RichText tagName="h2" placeholder={__('Heading', 'cecf-sage')} value={data.heading || ''} onChange={set('heading')} allowedFormats={[]} />
          <RichText tagName="p" className="lead" placeholder={__('Lead paragraph', 'cecf-sage')} value={data.lead || ''} onChange={set('lead')} allowedFormats={BOLD_ITALIC} />

          <div className={isMissionVision ? 'mv' : `cards${columns}`}>
            {items.map((item, index) => (
              <div key={index} className={isMissionVision ? 'mvcard cecf-item' : 'card cecf-item'}>
                <ItemControls
                  index={index}
                  count={items.length}
                  onMove={(i, direction) => onChange({ ...data, items: moveItem(items, i, direction) })}
                  onRemove={() => onChange({ ...data, items: items.filter((_, i) => i !== index) })}
                />
                <div className="cecf-item__settings" contentEditable={false}>
                  <SelectControl
                    __nextHasNoMarginBottom
                    label={__('Icon', 'cecf-sage')}
                    value={item.icon || ''}
                    options={iconOptions()}
                    onChange={(icon) => setItem(index, { icon })}
                  />
                  <SelectControl
                    __nextHasNoMarginBottom
                    label={__('Colour', 'cecf-sage')}
                    value={item.color || 'teal'}
                    options={selectOptions(COLOR_OPTIONS)}
                    onChange={(color) => setItem(index, { color })}
                  />
                </div>
                <RichText
                  tagName="h3"
                  placeholder={__('Card title', 'cecf-sage')}
                  value={item.title || ''}
                  onChange={(title) => setItem(index, { title })}
                  allowedFormats={[]}
                />
                <RichText
                  tagName="p"
                  placeholder={__('Card body', 'cecf-sage')}
                  value={item.body || ''}
                  onChange={(body) => setItem(index, { body })}
                  allowedFormats={BOLD_ITALIC}
                />
                {! isMissionVision && (
                  <div className="cecf-item__settings" contentEditable={false}>
                    <StringListField
                      field={{ key: 'mono', label: __('Monospace detail line', 'cecf-sage'), multiline: false }}
                      value={item.mono}
                      onChange={(mono) => setItem(index, { mono })}
                    />
                    <SelectControl
                      __nextHasNoMarginBottom
                      label={__('Links to page', 'cecf-sage')}
                      value={item.page || ''}
                      options={pageOptions()}
                      onChange={(page) => setItem(index, { page })}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => onChange({ ...data, items: [...items, { icon: '', color: 'teal', title: '', body: '' }] })}
          >
            {__('+ Add card', 'cecf-sage')}
          </Button>
        </div>
      </section>
    </>
  );
}

export function CtaBandEdit({ data, onChange }) {
  const set = (key) => (value) => onChange({ ...data, [key]: value });
  const ctas = Array.isArray(data.ctas) ? data.ctas : [];

  const setCta = (index, patch) => {
    const copy = [...ctas];
    copy[index] = { ...copy[index], ...patch };
    onChange({ ...data, ctas: copy });
  };

  return (
    <section className="band cecf-wysiwyg">
      <div className="wrap">
        <div className="band-g">
          <div>
            <RichText tagName="h2" placeholder={__('Heading', 'cecf-sage')} value={data.heading || ''} onChange={set('heading')} allowedFormats={[]} />
            <RichText tagName="p" placeholder={__('Body', 'cecf-sage')} value={data.body || ''} onChange={set('body')} allowedFormats={BOLD_ITALIC} />
          </div>
          <div className="row cecf-ctas">
            {ctas.map((cta, index) => (
              <div key={index} className="cecf-item cecf-cta-item">
                <ItemControls
                  index={index}
                  count={ctas.length}
                  onMove={(i, direction) => onChange({ ...data, ctas: moveItem(ctas, i, direction) })}
                  onRemove={() => onChange({ ...data, ctas: ctas.filter((_, i) => i !== index) })}
                />
                <RichText
                  tagName="span"
                  className={`btn ${buttonStyleClass(cta.style)}`}
                  placeholder={__('Button label', 'cecf-sage')}
                  value={cta.label || ''}
                  onChange={(label) => setCta(index, { label })}
                  allowedFormats={[]}
                />
                <div className="cecf-item__settings" contentEditable={false}>
                  <SelectControl __nextHasNoMarginBottom label={__('Links to page', 'cecf-sage')} value={cta.page || ''} options={pageOptions()} onChange={(page) => setCta(index, { page })} />
                  <SelectControl __nextHasNoMarginBottom label={__('Style', 'cecf-sage')} value={cta.style || 'primary'} options={selectOptions(BUTTON_STYLE_OPTIONS)} onChange={(style) => setCta(index, { style })} />
                  <SelectControl __nextHasNoMarginBottom label={__('Icon', 'cecf-sage')} value={cta.icon || ''} options={iconOptions()} onChange={(icon) => setCta(index, { icon })} />
                </div>
              </div>
            ))}
            <Button variant="secondary" size="small" onClick={() => onChange({ ...data, ctas: [...ctas, { label: '', page: '', style: 'primary', icon: '' }] })}>
              {__('+ Add button', 'cecf-sage')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CalloutEdit({ data, onChange }) {
  const set = (key) => (value) => onChange({ ...data, [key]: value });

  return (
    <div className="wrap cecf-wysiwyg" style={{ margin: '28px auto' }}>
      <RichText tagName="h3" className="mt-l" placeholder={__('Heading (optional)', 'cecf-sage')} value={data.heading || ''} onChange={set('heading')} allowedFormats={[]} />
      <div className="callout">
        <RichText tagName="p" placeholder={__('Body', 'cecf-sage')} value={data.body || ''} onChange={set('body')} allowedFormats={BOLD_ITALIC} />
      </div>
    </div>
  );
}

export function NoteEdit({ data, onChange }) {
  const set = (key) => (value) => onChange({ ...data, [key]: value });
  const variant = data.variant || 'info';

  return (
    <>
      <InspectorControls>
        <PanelBody title={__('Note settings', 'cecf-sage')} initialOpen>
          <SelectControl
            __nextHasNoMarginBottom
            label={__('Style', 'cecf-sage')}
            value={variant}
            options={selectOptions({ info: 'Info', warn: 'Warning', fineprint: 'Fine print' })}
            onChange={set('variant')}
          />
        </PanelBody>
      </InspectorControls>
      <div className="wrap cecf-wysiwyg" style={{ margin: '28px auto' }}>
        {variant === 'fineprint' ? (
          <RichText tagName="p" className="fineprint" placeholder={__('Body', 'cecf-sage')} value={data.body || ''} onChange={set('body')} allowedFormats={BOLD_ITALIC} />
        ) : (
          <div className={`note${variant === 'warn' ? ' warn' : ''}`}>
            <RichText tagName="p" placeholder={__('Body', 'cecf-sage')} value={data.body || ''} onChange={set('body')} allowedFormats={BOLD_ITALIC} />
          </div>
        )}
      </div>
    </>
  );
}

export function StatGridEdit({ data, onChange }) {
  const set = (key) => (value) => onChange({ ...data, [key]: value });
  const isStat4 = (data.columns || 3) == 4;
  const items = Array.isArray(data.items) ? data.items : [];

  const setItem = (index, patch) => {
    const copy = [...items];
    copy[index] = { ...copy[index], ...patch };
    onChange({ ...data, items: copy });
  };

  return (
    <>
      <InspectorControls>
        <PanelBody title={__('Stat grid settings', 'cecf-sage')} initialOpen>
          <SelectControl
            __nextHasNoMarginBottom
            label={__('Columns', 'cecf-sage')}
            value={String(data.columns || 3)}
            options={selectOptions({ 3: '3 (tinted)', 4: '4 (white cards)' })}
            onChange={set('columns')}
          />
        </PanelBody>
      </InspectorControls>
      <div className="wrap cecf-wysiwyg" style={{ margin: '28px auto' }}>
        <RichText tagName="h2" placeholder={__('Heading', 'cecf-sage')} value={data.heading || ''} onChange={set('heading')} allowedFormats={[]} />
        <div className={isStat4 ? 'stat4' : 'factbox'}>
          {items.map((item, index) => (
            <div key={index} className="cecf-item">
              <ItemControls
                index={index}
                count={items.length}
                onMove={(i, direction) => onChange({ ...data, items: moveItem(items, i, direction) })}
                onRemove={() => onChange({ ...data, items: items.filter((_, i) => i !== index) })}
              />
              <RichText tagName="span" className={isStat4 ? 'n' : 'fn'} placeholder={__('Value', 'cecf-sage')} value={item.value || ''} onChange={(value) => setItem(index, { value })} allowedFormats={[]} />
              <RichText tagName="span" className={isStat4 ? 'l' : 'fl'} placeholder={__('Label', 'cecf-sage')} value={item.label || ''} onChange={(label) => setItem(index, { label })} allowedFormats={[]} />
            </div>
          ))}
        </div>
        <Button variant="secondary" size="small" onClick={() => onChange({ ...data, items: [...items, { value: '', label: '' }] })}>
          {__('+ Add stat', 'cecf-sage')}
        </Button>
        <RichText tagName="p" className="fineprint" placeholder={__('Fine print (optional)', 'cecf-sage')} value={data.fineprint || ''} onChange={set('fineprint')} allowedFormats={BOLD_ITALIC} />
      </div>
    </>
  );
}

/**
 * type -> hand-authored WYSIWYG Edit component, read by register.jsx.
 * Every `cecf/*` type not listed here falls back to the generic
 * canvas form (SectionForm).
 */
export const WYSIWYG_LAYOUTS = {
  phead: PheadEdit,
  cardGrid: CardGridEdit,
  ctaBand: CtaBandEdit,
  callout: CalloutEdit,
  note: NoteEdit,
  statGrid: StatGridEdit,
};
