<?php

namespace App\Support;

/**
 * "Jane Wanjiru Mwangi" -> "JM" — the fallback avatar `teamGrid` shows in
 * place of a real headshot (see database/content/media/photos/
 * PLACEHOLDERS.md's reasoning for why photos aren't seeded at all: no
 * real CECF staff/board photography exists to seed yet). First and last
 * word of the name, uppercased; a single-word name just uses its first
 * letter.
 */
class Initials
{
    public static function of(string $name): string
    {
        $words = preg_split('/\s+/', trim($name)) ?: [];
        $words = array_values(array_filter($words, fn($w) => $w !== ''));

        if ($words === []) {
            return '';
        }

        if (count($words) === 1) {
            return mb_strtoupper(mb_substr($words[0], 0, 1));
        }

        $first = mb_substr($words[0], 0, 1);
        $last = mb_substr($words[count($words) - 1], 0, 1);

        return mb_strtoupper($first . $last);
    }
}
