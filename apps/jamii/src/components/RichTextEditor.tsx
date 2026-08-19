'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

/**
 * Dashboard-only WYSIWYG editor for rich-text fields (About, Programme
 * descriptions, Post/Campaign bodies, FAQ answers). StarterKit + Link
 * only — no image/table/embed extensions, matching the tight allow-list
 * sanitizeRichText() (packages/domain/src/rich-text.ts) enforces on the
 * server. The dashboard is never whitelabel-themed (see OrgTopNav's
 * header comment), so this always renders in the primary "manila
 * ledger" look regardless of which org's content it's editing.
 *
 * Sanitization happens server-side only (write and read) — this
 * component intentionally never imports sanitizeRichText, keeping
 * isomorphic-dompurify/jsdom out of the client bundle.
 */
export function RichTextEditor({
  value, onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value,
    editorProps: {
      attributes: { class: 'rte-content' },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  if (!editor) return null;

  function toggleLink() {
    const prevUrl = editor!.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prevUrl ?? 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor!.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <button type="button" aria-pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
        <button type="button" aria-pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
        <button type="button" aria-pressed={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
        <button type="button" aria-pressed={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" aria-pressed={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
        <button type="button" aria-pressed={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
        <button type="button" aria-pressed={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
        <button type="button" aria-pressed={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>&ldquo;&rdquo;</button>
        <button type="button" aria-pressed={editor.isActive('link')} onClick={toggleLink}>Link</button>
        <button type="button" onClick={() => editor.chain().focus().undo().run()}>Undo</button>
        <button type="button" onClick={() => editor.chain().focus().redo().run()}>Redo</button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
