'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '@esoko/ui';
import { RichTextEditor } from '@/components/RichTextEditor';
import { actionSaveHomepageBlocks } from '../actions';
import { ADDABLE_TYPES, BLOCK_LABEL, type EditableBlock } from './default-blocks';

interface Row extends EditableBlock {
  /** Client-only stable key for @dnd-kit/React lists — `id` only
   *  exists once a block has actually been saved to the DB. */
  key: string;
}

let keySeq = 0;
function toRow(b: EditableBlock): Row {
  return { ...b, key: b.id ?? `new-${++keySeq}` };
}

function SortableRow({
  row, onChange, onRemove, photos,
}: {
  row: Row;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  photos: { id: string; url: string; caption: string | null }[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key });
  const [expanded, setExpanded] = useState(false);
  const editable = ['DONATE_BAND', 'RICH_TEXT', 'TESTIMONIAL', 'PHOTO_STRIP'].includes(row.type);

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const data = row.data as Record<string, unknown>;

  return (
    <div ref={setNodeRef} className="card" style={{ ...style, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" aria-label="Drag to reorder" {...attributes} {...listeners} style={{ cursor: 'grab', background: 'none', border: 0, padding: 4 }}>
          <Icon name="sort" size={16} />
        </button>
        <span style={{ fontWeight: 700, flex: 1 }}>{BLOCK_LABEL[row.type]}</span>
        <button
          type="button" aria-label={row.visible ? 'Hide this section' : 'Show this section'}
          onClick={() => onChange({ visible: !row.visible })}
          className="btn btn-outline btn-sm" style={{ opacity: row.visible ? 1 : 0.5 }}
        >
          <Icon name="eye" size={14} /> {row.visible ? 'Visible' : 'Hidden'}
        </button>
        {editable && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Close' : 'Edit'}
          </button>
        )}
        <button type="button" aria-label="Remove this section" className="btn btn-outline btn-sm" onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {expanded && row.type === 'DONATE_BAND' && (
        <div style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor={`${row.key}-heading`}>Heading</label><input id={`${row.key}-heading`} value={(data.heading as string) ?? ''} placeholder="Ways to partner" onChange={(e) => onChange({ data: { ...data, heading: e.target.value } })} /></div>
          <div className="field"><label htmlFor={`${row.key}-body`}>Body</label><textarea id={`${row.key}-body`} rows={3} value={(data.body as string) ?? ''} onChange={(e) => onChange({ data: { ...data, body: e.target.value } })} /></div>
        </div>
      )}

      {expanded && row.type === 'RICH_TEXT' && (
        <div style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor={`${row.key}-heading`}>Heading (optional)</label><input id={`${row.key}-heading`} value={(data.heading as string) ?? ''} onChange={(e) => onChange({ data: { ...data, heading: e.target.value } })} /></div>
          <div className="field">
            {/* RichTextEditor's Tiptap surface has no single labelable
                input, so this is a styled span rather than a <label>
                (which jsx-a11y correctly flags as orphaned otherwise). */}
            <span style={{ display: 'block', fontSize: '.8rem', fontWeight: 700, color: 'var(--ink)', marginBottom: 7 }}>Content</span>
            <RichTextEditor value={(data.html as string) ?? ''} onChange={(html) => onChange({ data: { ...data, html } })} />
          </div>
        </div>
      )}

      {expanded && row.type === 'TESTIMONIAL' && (
        <div style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor={`${row.key}-quote`}>Quote</label><textarea id={`${row.key}-quote`} rows={3} value={(data.quote as string) ?? ''} onChange={(e) => onChange({ data: { ...data, quote: e.target.value } })} /></div>
          <div className="formrow2">
            <div className="field"><label htmlFor={`${row.key}-name`}>Name</label><input id={`${row.key}-name`} value={(data.name as string) ?? ''} onChange={(e) => onChange({ data: { ...data, name: e.target.value } })} /></div>
            <div className="field"><label htmlFor={`${row.key}-role`}>Role (optional)</label><input id={`${row.key}-role`} value={(data.role as string) ?? ''} onChange={(e) => onChange({ data: { ...data, role: e.target.value } })} /></div>
          </div>
        </div>
      )}

      {expanded && row.type === 'PHOTO_STRIP' && (
        <div style={{ marginTop: 14 }}>
          {photos.length === 0 ? (
            <p className="hint">Upload photos in Gallery first, then come back here to pick some.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {photos.map((photo) => {
                const ids = (data.photoIds as string[]) ?? [];
                const checked = ids.includes(photo.id);
                return (
                  <label key={photo.id} style={{ position: 'relative', cursor: 'pointer' }}>
                    <img
                      src={photo.url} alt={photo.caption ?? ''} width={72} height={72}
                      style={{ objectFit: 'cover', borderRadius: 8, border: checked ? '3px solid var(--stamp)' : '1px solid var(--paper-line)' }}
                    />
                    <input
                      type="checkbox" checked={checked} style={{ position: 'absolute', top: 4, right: 4 }}
                      onChange={(e) => onChange({
                        data: { ...data, photoIds: e.target.checked ? [...ids, photo.id] : ids.filter((id) => id !== photo.id) },
                      })}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BlockEditor({
  pageId, initialBlocks, photos,
}: {
  pageId: string;
  initialBlocks: EditableBlock[];
  photos: { id: string; url: string; caption: string | null }[];
}) {
  const [rows, setRows] = useState<Row[]>(() => initialBlocks.map(toRow));
  const [addType, setAddType] = useState(ADDABLE_TYPES[0]!.type);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setSaved(false);
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
    setSaved(false);
  }

  function addBlock() {
    const preset = ADDABLE_TYPES.find((t) => t.type === addType)!;
    setRows((r) => [...r, toRow({ type: preset.type, visible: true, data: { ...preset.defaultData } })]);
    setSaved(false);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((r) => {
      const oldIndex = r.findIndex((row) => row.key === active.id);
      const newIndex = r.findIndex((row) => row.key === over.id);
      return arrayMove(r, oldIndex, newIndex);
    });
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await actionSaveHomepageBlocks(
        pageId,
        rows.map(({ id, type, visible, data }) => ({ id, type, visible, data })),
      );
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          {rows.map((row) => (
            <SortableRow
              key={row.key} row={row} photos={photos}
              onChange={(patch) => patchRow(row.key, patch)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        <select value={addType} onChange={(e) => setAddType(e.target.value as typeof addType)}>
          {ADDABLE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        <button type="button" className="btn btn-outline btn-sm" onClick={addBlock}>
          <Icon name="plus" size={14} /> Add section
        </button>
      </div>

      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 12 }}>Saved.</p>}
      <button type="button" className="btn btn-stamp" disabled={pending} onClick={save}>
        {pending ? 'Saving…' : 'Save homepage'}
      </button>
    </div>
  );
}
