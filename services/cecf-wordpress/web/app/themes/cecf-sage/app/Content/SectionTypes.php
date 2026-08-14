<?php

namespace App\Content;

/**
 * The single canonical list of section `type` values a page can be built
 * from — see database/content/README.md's schema table, which this mirrors
 * exactly. Both the Meta Box field registration (App\Providers\
 * CecfContentServiceProvider, for the admin-editable "type" dropdown) and
 * PageSeeder (database/seeders/PageSeeder.php, for validating what's in the
 * JSON before it's written to the database) read from here, so the list
 * only ever needs to change in one place.
 */
class SectionTypes
{
    /**
     * @return array<string, string> machine value => human label
     */
    public static function options(): array
    {
        return [
            'hero' => 'Hero (homepage masthead)',
            'phead' => 'Page header banner',
            'prose' => 'Prose (freeform paragraphs)',
            'twoColumn' => 'Two-column (prose + media)',
            'statGrid' => 'Stat grid',
            'cardGrid' => 'Card grid',
            'stepList' => 'Step list',
            'requirementList' => 'Requirement checklist',
            'table' => 'Table',
            'eventList' => 'Event list',
            'newsList' => 'News list',
            'storyList' => 'Story / testimonial list',
            'downloadList' => 'Download list',
            'sponsorshipGrid' => 'Sponsorship grid',
            'partnerList' => 'Partner / institution list',
            'ctaBand' => 'CTA band',
            'callout' => 'Callout',
            'note' => 'Note',
            'registrationForm' => 'Registration form (copy only — behaviour is code)',
            'linkOut' => 'Single link-out button',
            'linkRow' => 'Row of link-out buttons',
        ];
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_keys(self::options());
    }

    public static function isValid(string $type): bool
    {
        return array_key_exists($type, self::options());
    }
}
