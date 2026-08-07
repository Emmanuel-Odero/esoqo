<?php

namespace App\Support;

/**
 * Maps the `style` value on a seeded CTA ({label, page, style, icon}) to
 * the template's button CSS class. Used by ctaBand, linkOut and linkRow —
 * three partials that would otherwise each carry their own copy of this
 * same three-way mapping.
 */
class ButtonStyle
{
    public static function cssClass(?string $style): string
    {
        return match ($style) {
            'outline' => 'btn-o',
            'outline-white' => 'btn-w',
            default => 'btn-p',
        };
    }
}
