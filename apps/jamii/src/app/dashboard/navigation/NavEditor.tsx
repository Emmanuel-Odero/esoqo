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
import { Icon } from '@esoqo/ui';
import { actionSaveNavItems } from '../actions';

export interface NavItemInput {
  id?: string;
  label: string;
  visible: boolean;
  openInNewTab: boolean;
  targetKind: 'SITE_PAGE' | 'EXTERNAL_URL';
  targetSitePageId?: string;
  externalUrl?: string;
}

interface Row extends NavItemInput {
  key: string;
}

let keySeq = 0;
function toRow(i: NavItemInput): Row {
  return { ...i, key: i.id ?? `new-${++keySeq}` };
}

function SortableRow({
  row, sitePages, onChange, onRemove,
}: {
  row: Row;
  sitePages: { id: string; title: string }[];
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} className="card" style={{ ...style, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" aria-label="Drag to reorder" {...attributes} {...listeners} style={{ cursor: 'grab', background: 'none', border: 0, padding: 4 }}>
          <Icon name="sort" size={16} />
        </button>

        <input
          aria-label="Menu label" value={row.label} placeholder="Label" style={{ width: 160 }}
          onChange={(e) => onChange({ label: e.target.value })}
        />

        {row.targetKind === 'SITE_PAGE' ? (
          <select
            aria-label="Linked page" value={row.targetSitePageId ?? ''} style={{ flex: 1, minWidth: 160 }}
            onChange={(e) => onChange({ targetSitePageId: e.target.value })}
          >
            <option value="" disabled>Choose a page…</option>
            {sitePages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        ) : (
          <input
            aria-label="External URL" value={row.externalUrl ?? ''} placeholder="https://…" style={{ flex: 1, minWidth: 160 }}
            onChange={(e) => onChange({ externalUrl: e.target.value })}
          />
        )}

        {row.targetKind === 'EXTERNAL_URL' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem' }}>
            <input type="checkbox" checked={row.openInNewTab} onChange={(e) => onChange({ openInNewTab: e.target.checked })} />
            New tab
          </label>
        )}

        <button
          type="button" aria-label={row.visible ? 'Hide from menu' : 'Show in menu'}
          onClick={() => onChange({ visible: !row.visible })}
          className="btn btn-outline btn-sm" style={{ opacity: row.visible ? 1 : 0.5 }}
        >
          <Icon name="eye" size={14} /> {row.visible ? 'Visible' : 'Hidden'}
        </button>
        <button type="button" aria-label="Remove from menu" className="btn btn-outline btn-sm" onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

export function NavEditor({
  pageId, initialItems, sitePages,
}: {
  pageId: string;
  initialItems: NavItemInput[];
  sitePages: { id: string; title: string }[];
}) {
  const [rows, setRows] = useState<Row[]>(() => initialItems.map(toRow));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const usedPageIds = new Set(rows.filter((r) => r.targetKind === 'SITE_PAGE').map((r) => r.targetSitePageId));
  const availablePages = sitePages.filter((p) => !usedPageIds.has(p.id));

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setSaved(false);
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
    setSaved(false);
  }

  function addPageLink() {
    const first = availablePages[0];
    if (!first) return;
    setRows((r) => [...r, toRow({
      label: first.title, visible: true, openInNewTab: false, targetKind: 'SITE_PAGE', targetSitePageId: first.id,
    })]);
    setSaved(false);
  }

  function addExternalLink() {
    setRows((r) => [...r, toRow({
      label: 'New link', visible: true, openInNewTab: true, targetKind: 'EXTERNAL_URL', externalUrl: '',
    })]);
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
      const result = await actionSaveNavItems(
        pageId,
        rows.map(({ id, label, visible, openInNewTab, targetKind, targetSitePageId, externalUrl }) => (
          { id, label, visible, openInNewTab, targetKind, targetSitePageId, externalUrl }
        )),
      );
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ padding: 14, marginBottom: 10, opacity: 0.7 }}>
        <span style={{ fontWeight: 700 }}>Home</span>
        <span style={{ fontSize: '.8rem', marginLeft: 8 }}>Always first, always visible.</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          {rows.map((row) => (
            <SortableRow
              key={row.key} row={row} sitePages={sitePages}
              onChange={(patch) => patchRow(row.key, patch)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={availablePages.length === 0} onClick={addPageLink}>
          <Icon name="plus" size={14} /> Add a page
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={addExternalLink}>
          <Icon name="plus" size={14} /> Add a link
        </button>
      </div>

      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 12 }}>Saved.</p>}
      <button type="button" className="btn btn-stamp" disabled={pending} onClick={save}>
        {pending ? 'Saving…' : 'Save menu'}
      </button>
    </div>
  );
}
