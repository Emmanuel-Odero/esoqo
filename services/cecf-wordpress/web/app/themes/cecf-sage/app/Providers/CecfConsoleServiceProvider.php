<?php

namespace App\Providers;

use App\Console\Commands\CecfSeedCommand;
use Illuminate\Support\ServiceProvider;

/**
 * Registers this theme's `wp acorn` commands. Kept separate from
 * ThemeServiceProvider (Sage's own scaffolded provider) and from
 * CecfContentServiceProvider/CecfEnquiryServiceProvider (which register
 * WordPress hooks, not console commands) — one provider per concern.
 */
class CecfConsoleServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([
                CecfSeedCommand::class,
            ]);
        }
    }
}
