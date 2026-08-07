<?php

namespace Database\Seeders;

use App\Content\ContentRepository;

/**
 * Orchestrates the four individually-testable seeders above. This is the
 * only class App\Console\Commands\CecfSeedCommand talks to — it doesn't
 * know about ContentRepository, Meta Box, or wp_insert_post at all, which
 * is the separation this pass was asked to keep: reading (ContentRepository),
 * writing (the four Seeders), and the CLI surface (the Command) are three
 * different concerns in three different places.
 *
 * Run order matters: pages before navigation, because the nav menu links
 * to page IDs that must already exist.
 */
class CecfSeeder
{
    protected ContentRepository $content;

    /** @var array<string, int> page key => post ID, populated by seedPages() */
    protected array $pageIds = [];

    /** @var array<string, int> step name => item count, for CLI output */
    public array $summary = [];

    public function __construct(?ContentRepository $content = null)
    {
        $this->content = $content ?? new ContentRepository();
    }

    /**
     * @return array<string, int> filename => attachment ID
     */
    public function seedMedia(): array
    {
        $map = (new MediaSeeder($this->content))->run();
        $this->summary['media'] = count($map);

        return $map;
    }

    /**
     * @return array<string, int> page key => post ID
     */
    public function seedPages(): array
    {
        $this->pageIds = (new PageSeeder($this->content))->run();
        $this->summary['pages'] = count($this->pageIds);

        return $this->pageIds;
    }

    public function seedNavigation(): int
    {
        if ($this->pageIds === []) {
            $this->pageIds = (new PageSeeder($this->content))->existingPageIds();
        }

        $menuId = (new NavigationSeeder($this->content))->run($this->pageIds);
        $this->summary['navigation'] = count($this->pageIds);

        return $menuId;
    }

    public function seedSettings(): void
    {
        (new SiteSettingsSeeder($this->content))->run();
        $this->summary['settings'] = 1;
    }
}
