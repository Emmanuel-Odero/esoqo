import { sanitizeRichText } from '@esoqo/domain';

/**
 * Renders a sanitized-HTML rich-text field (About, Programme
 * descriptions, Post/Campaign bodies, FAQ answers — see
 * RichTextEditor.tsx for where these are authored). Sanitizes *again*
 * here at render time, on top of the write-time sanitization every
 * Server Action already runs (packages/domain/src/rich-text.ts) —
 * defense in depth for values written before this system existed, or
 * by any future direct-DB path.
 *
 * Server Component only — never import this from a 'use client' file,
 * it would pull isomorphic-dompurify/jsdom into the client bundle.
 */
export function RichText({
  html, className, fallback = null,
}: {
  html: string | null | undefined;
  className?: string;
  fallback?: React.ReactNode;
}) {
  if (!html?.trim()) return <>{fallback}</>;
  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }} />;
}
