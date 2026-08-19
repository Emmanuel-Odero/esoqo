import DOMPurify from 'isomorphic-dompurify';
import { z } from 'zod';

/**
 * Sanitization for user-authored rich text (Our Jamii's Tiptap fields:
 * JamiiPage.aboutUs, JamiiProgram.body, JamiiPost.body, Campaign.body,
 * CampaignUpdate.body, FAQ answers). Every Server Action accepting rich
 * text runs the raw HTML through this on the server, before it ever
 * reaches the DAL — mirrors the "never trust client input, verify
 * server-side" discipline sniff() in storage.ts follows for uploads.
 * Public render sites sanitize *again* at render time (defense in
 * depth — a value written before this system existed, or by a future
 * direct-DB path, should never be trusted blindly).
 *
 * Tight allow-list: enough for Tiptap's StarterKit + Link extension
 * (the only extensions RichTextEditor.tsx loads), nothing else. No
 * script/style/iframe/img — images are uploaded separately via R2 (see
 * AssetUpload), never inlined into rich text, so paste-in <img> tags
 * are stripped rather than allowed through.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'a',
  'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote',
];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Belt-and-braces alongside the allow-list above — DOMPurify already
    // strips onclick/etc. by omission, this just makes the intent explicit.
    ALLOW_DATA_ATTR: false,
  }).trim();
}

/** A rich-text field's Zod shape — sanitizes as part of validation, so a
 *  Server Action's safeParse() output is already safe to store. Kept
 *  generous on raw length (the editor's own UI is the practical limit);
 *  this is a backstop against pathological payloads, not a UX constraint.
 *  `min`, when given, checks the *raw* HTML length before sanitizing —
 *  an approximation of "wrote something" (an empty Tiptap doc is
 *  `<p></p>`, 7 chars), not exact, but good enough to catch a truly
 *  blank submission without being a second full parser. */
export function richTextField(maxLen = 20_000, min?: { length: number; message: string }) {
  const base = z.string().trim().max(maxLen);
  return (min ? base.min(min.length, min.message) : base).transform(sanitizeRichText);
}
