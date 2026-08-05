/**
 * Shown instantly while a dashboard route's server component is still
 * fetching — every page under here is `force-dynamic`, so without this
 * the browser would otherwise just sit blank mid-navigation. Keeping it
 * generic (no page-specific skeleton) is deliberate: one file covers
 * every route, and a plain spinner beats a blank screen either way.
 */
export default function DashboardLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
