<?php

namespace App\Console\Commands;

use Database\Seeders\CecfSeeder;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * `wp acorn cecf:seed` — populates real CECF content from
 * database/content/. See docs/content-seeding-plan.md §3.5 for why this is
 * a theme-owned Acorn command (roots/acorn is already a theme dependency)
 * rather than a standalone WP-CLI mu-plugin.
 *
 * Safe to re-run: every step upserts by a stable content key rather than
 * appending, so running it twice leaves the site matching
 * database/content/ exactly, not duplicated. That's also why there's no
 * --force flag — there is nothing an unforced run holds back on.
 *
 * Not meant to run automatically on deploy (see docker/entrypoint.sh,
 * which deliberately does not call this) — once CECF staff have live-
 * edited content in wp-admin, a redeploy re-running this would silently
 * overwrite their edits.
 */
class CecfSeedCommand extends Command
{
    /** @var string */
    protected $signature = 'cecf:seed
        {--pages : Seed pages and their sections}
        {--nav : Seed the primary navigation menu (needs pages already seeded, this run or a previous one)}
        {--settings : Seed site settings and footer navigation columns}
        {--media : Seed the bespoke illustration SVGs into the media library}';

    /** @var string */
    protected $description = 'Seed real CECF content (pages, nav, settings, media) from database/content/. Runs every step if none of the flags are given.';

    public function handle(): int
    {
        $steps = ['media', 'pages', 'nav', 'settings'];
        $requested = array_values(array_filter($steps, fn (string $step) => (bool) $this->option($step)));
        $runAll = $requested === [];

        $shouldRun = fn (string $step) => $runAll || in_array($step, $requested, true);

        $seeder = new CecfSeeder();

        try {
            if ($shouldRun('media')) {
                $this->line('Seeding illustration SVGs into the media library...');
                $seeder->seedMedia();
            }

            if ($shouldRun('pages')) {
                $this->line('Seeding pages and their sections...');
                $seeder->seedPages();
            }

            if ($shouldRun('nav')) {
                $this->line('Seeding primary navigation...');
                $seeder->seedNavigation();
            }

            if ($shouldRun('settings')) {
                $this->line('Seeding site settings and footer navigation...');
                $seeder->seedSettings();
            }
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->newLine();
        foreach ($seeder->summary as $step => $count) {
            $this->line("  <info>{$step}</info>: {$count}");
        }

        $this->newLine();
        $this->info('CECF content seed complete.');

        return self::SUCCESS;
    }
}
