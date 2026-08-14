<?php

namespace App\Support;

/**
 * The seed content in database/content/pages/*.json writes emphasis as
 * plain `**bold**` / `*italic*` (readable/diffable in a JSON string,
 * matching how it reads in the design template's own copy) rather than
 * inline HTML. This is the one place that turns it into markup — every
 * partial that prints body text goes through here instead of each
 * re-implementing the same two regexes.
 *
 * Escapes first, then applies emphasis, so this is safe to feed directly
 * to `{!! !!}` — never call this on anything except our own seeded JSON
 * strings (not on the eventual cecf_enquiry form submissions, which are
 * user input and go through sanitize_text_field() instead, never this).
 */
class Markdown
{
    public static function inline(string $text): string
    {
        $escaped = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');

        $escaped = preg_replace('/\*\*(.+?)\*\*/', '<strong>$1</strong>', $escaped);
        $escaped = preg_replace('/(?<!\*)\*([^*]+?)\*(?!\*)/', '<em>$1</em>', $escaped);

        return $escaped;
    }

    /**
     * A "### Heading" on its own line becomes an <h3>; everything else is
     * treated as a paragraph and passed through inline(). Used by
     * twoColumn's `prose` arrays (see database/content/pages/results.json),
     * the only place seed content currently mixes sub-headings into a
     * prose block rather than using a separate `subheading` field.
     */
    public static function block(string $text): string
    {
        if (str_starts_with(trim($text), '### ')) {
            return '<h3 class="mt">'.self::inline(substr(trim($text), 4)).'</h3>';
        }

        return '<p>'.self::inline($text).'</p>';
    }
}
