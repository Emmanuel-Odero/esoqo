/**
 * One generic, recursive field renderer for every `cecf/*` block's
 * Inspector controls, driven entirely by the schema
 * App\Content\SectionFields hands the editor as `window.cecfSectionSchema`
 * (see App\Providers\CecfBlocksServiceProvider::localizeEditorData()).
 *
 * There is deliberately no per-block-type edit.js in this theme — every
 * `cecf/*` block (see register.js) renders the *same* <SectionForm>
 * against a different field list, so adding a field to a section type
 * only ever means editing SectionFields.php, never touching JS.
 */
import {
  TextControl,
  TextareaControl,
  ToggleControl,
  SelectControl,
  Button,
  Card,
  CardBody,
  CardHeader,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

const pageOptions = () => [
  { label: __('— None —', 'cecf-sage'), value: '' },
  ...Object.entries(window.cecfPageOptions || {}).map(([value, label]) => ({ value, label })),
];

const iconOptions = () => [
  { label: __('— None —', 'cecf-sage'), value: '' },
  ...Object.entries(window.cecfIconOptions || {}).map(([value, label]) => ({ value, label })),
];

const illustrationOptions = () => [
  { label: __('— None —', 'cecf-sage'), value: '' },
  ...Object.entries(window.cecfIllustrationOptions || {}).map(([value, label]) => ({ value, label })),
];

const selectOptions = (options) => Object.entries(options || {}).map(([value, label]) => ({ value, label }));

function emptyValueFor(field) {
  switch (field.type) {
    case 'boolean':
      return false;
    case 'stringList':
    case 'rowList':
    case 'repeater':
      return [];
    case 'group':
      return {};
    default:
      return '';
  }
}

function emptyItemFor(fields) {
  const item = {};
  for (const field of fields) {
    item[field.key] = emptyValueFor(field);
  }
  return item;
}

/**
 * A repeatable list of plain strings — `facts`, `ticks`, prose paragraphs.
 */
function StringListField({ field, value, onChange }) {
  const items = Array.isArray(value) ? value : [];
  const Control = field.multiline ? TextareaControl : TextControl;

  return (
    <div className="cecf-field-list">
      {items.map((item, index) => (
        <div key={index} className="cecf-field-list__row">
          <Control
            __nextHasNoMarginBottom
            label={`${field.label} ${index + 1}`}
            value={item}
            onChange={(next) => {
              const copy = [...items];
              copy[index] = next;
              onChange(copy);
            }}
          />
          <Button
            variant="tertiary"
            isDestructive
            size="small"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            {__('Remove', 'cecf-sage')}
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="small" onClick={() => onChange([...items, ''])}>
        {__('+ Add', 'cecf-sage')} {field.label}
      </Button>
    </div>
  );
}

/**
 * Table rows only — a repeatable list of string-lists (one row = one
 * array of cell strings), matching partials/cecf/table.blade.php's
 * `foreach ($data['rows'] as $row) foreach ($row as $cell)`.
 */
function RowListField({ field, value, onChange }) {
  const rows = Array.isArray(value) ? value : [];

  return (
    <div className="cecf-field-list">
      {rows.map((row, rowIndex) => (
        <Card key={rowIndex} size="small" className="cecf-field-group">
          <CardHeader>
            <strong>{__('Row', 'cecf-sage')} {rowIndex + 1}</strong>
            <Button
              variant="tertiary"
              isDestructive
              size="small"
              onClick={() => onChange(rows.filter((_, i) => i !== rowIndex))}
            >
              {__('Remove row', 'cecf-sage')}
            </Button>
          </CardHeader>
          <CardBody>
            <StringListField
              field={{ key: 'cells', label: __('Cell', 'cecf-sage'), multiline: false }}
              value={row}
              onChange={(cells) => {
                const copy = [...rows];
                copy[rowIndex] = cells;
                onChange(copy);
              }}
            />
          </CardBody>
        </Card>
      ))}
      <Button variant="secondary" size="small" onClick={() => onChange([...rows, []])}>
        {__('+ Add row', 'cecf-sage')}
      </Button>
    </div>
  );
}

/**
 * A repeatable list of objects, each shaped by `field.fields` — cardGrid
 * items, hero ctas, table-free repeaters generally.
 */
function RepeaterField({ field, value, onChange }) {
  const items = Array.isArray(value) ? value : [];

  return (
    <div className="cecf-field-list">
      {items.map((item, index) => (
        <Card key={index} size="small" className="cecf-field-group">
          <CardHeader>
            <strong>{field.label} {index + 1}</strong>
            <Button
              variant="tertiary"
              isDestructive
              size="small"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              {__('Remove', 'cecf-sage')}
            </Button>
          </CardHeader>
          <CardBody>
            <SectionForm
              fields={field.fields}
              data={item || {}}
              onChange={(next) => {
                const copy = [...items];
                copy[index] = next;
                onChange(copy);
              }}
            />
          </CardBody>
        </Card>
      ))}
      <Button
        variant="secondary"
        size="small"
        onClick={() => onChange([...items, emptyItemFor(field.fields)])}
      >
        {__('+ Add', 'cecf-sage')} {field.label}
      </Button>
    </div>
  );
}

/**
 * A single fixed sub-object — twoColumn's `cta`/`media`, a button's own
 * {label, page, style, icon} shape.
 */
function GroupField({ field, value, onChange }) {
  return (
    <Card size="small" className="cecf-field-group">
      <CardHeader>
        <strong>{field.label}</strong>
      </CardHeader>
      <CardBody>
        <SectionForm
          fields={field.fields}
          data={value || {}}
          onChange={onChange}
        />
      </CardBody>
    </Card>
  );
}

function ScalarField({ field, value, onChange }) {
  const label = field.label;

  switch (field.type) {
    case 'boolean':
      return <ToggleControl __nextHasNoMarginBottom label={label} checked={!!value} onChange={onChange} />;

    case 'textarea':
      return (
        <TextareaControl
          __nextHasNoMarginBottom
          label={label}
          value={value || ''}
          onChange={onChange}
          help={field.help}
        />
      );

    case 'select':
      return (
        <SelectControl
          __nextHasNoMarginBottom
          label={label}
          value={value || ''}
          options={selectOptions(field.options)}
          onChange={onChange}
        />
      );

    case 'page':
      return (
        <SelectControl
          __nextHasNoMarginBottom
          label={label}
          value={value || ''}
          options={pageOptions()}
          onChange={onChange}
        />
      );

    case 'icon':
      return (
        <SelectControl
          __nextHasNoMarginBottom
          label={label}
          value={value || ''}
          options={iconOptions()}
          onChange={onChange}
        />
      );

    case 'illustration':
      return (
        <SelectControl
          __nextHasNoMarginBottom
          label={label}
          value={value || ''}
          options={illustrationOptions()}
          onChange={onChange}
        />
      );

    case 'number':
      return (
        <TextControl
          __nextHasNoMarginBottom
          type="number"
          label={label}
          value={value ?? ''}
          onChange={onChange}
        />
      );

    case 'text':
    default:
      return (
        <TextControl __nextHasNoMarginBottom label={label} value={value || ''} onChange={onChange} />
      );
  }
}

/**
 * Renders one field of any type against `data[field.key]`, dispatching
 * to the right sub-component above.
 */
function Field({ field, data, onChange }) {
  const value = data[field.key];
  const setValue = (next) => onChange({ ...data, [field.key]: next });

  switch (field.type) {
    case 'stringList':
      return <StringListField field={field} value={value} onChange={setValue} />;
    case 'rowList':
      return <RowListField field={field} value={value} onChange={setValue} />;
    case 'repeater':
      return <RepeaterField field={field} value={value} onChange={setValue} />;
    case 'group':
      return <GroupField field={field} value={value} onChange={setValue} />;
    default:
      return <ScalarField field={field} value={value} onChange={setValue} />;
  }
}

/**
 * The recursive form itself: one <Field> per schema entry. Both the
 * top-level block Inspector panel (register.js) and every nested
 * repeater/group above call back into this, which is what makes the
 * schema recursive without any type-specific JS beyond the six renderers
 * above.
 */
export function SectionForm({ fields, data, onChange }) {
  return (
    <>
      {fields.map((field) => (
        <div className="cecf-field" key={field.key}>
          <Field field={field} data={data} onChange={onChange} />
        </div>
      ))}
    </>
  );
}
