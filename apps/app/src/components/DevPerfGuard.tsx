"use client";

/**
 * Dev-mode guard for React's server-component performance instrumentation.
 *
 * In `next dev` (Turbopack), React measures each server-rendered tree with
 * `performance.measure`. When a route aborts during its initial render —
 * `notFound()`/`redirect()` in a layout or page — the measure's start time is
 * computed negative and the browser throws:
 *
 *   Failed to execute 'measure' on 'Performance': 'ShellLayout' cannot have a
 *   negative time stamp.
 *
 * The abort happens so early (no children processed) that the tracked end time
 * is still -Infinity. Upstream: vercel/next.js#86060 (the proposed fix was
 * closed in favour of patching React's compiled dev bundle). This guard
 * swallows exactly that call so a console-only TypeError never becomes a
 * full-screen error overlay. Production builds are unaffected — the measure
 * call exists only in development.
 *
 * The patch is applied at module scope so it is installed before the initial
 * Flight stream is measured, and the flag keeps HMR remounts from wrapping the
 * already-wrapped function.
 */

interface GuardedMeasure {
  (
    measureName: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ): PerformanceMeasure;
  __esokoPatched?: boolean;
}

function patchNegativeTimestampMeasure(): void {
  if (typeof window === "undefined") return;
  const perf = window.performance;
  const original = perf.measure.bind(perf) as GuardedMeasure;
  if (original.__esokoPatched) return;

  const wrapped = ((...args: Parameters<typeof perf.measure>) => {
    try {
      return original(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Chrome: "... cannot have a negative time stamp."
      // Firefox: "... Given attribute end cannot be negative".
      if (
        message.includes("negative time stamp") ||
        message.includes("cannot be negative")
      ) {
        return undefined as unknown as PerformanceMeasure;
      }
      throw err;
    }
  }) as GuardedMeasure;

  wrapped.__esokoPatched = true;
  perf.measure = wrapped;
}

patchNegativeTimestampMeasure();

/** Rendered once from the root layout; contributes no DOM. */
export function DevPerfGuard() {
  return null;
}