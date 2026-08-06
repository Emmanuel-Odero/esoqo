export interface SkipLink {
  href: string;
  label: string;
}

const DEFAULT_LINKS: SkipLink[] = [{ href: '#main', label: 'Skip to content' }];

/**
 * `#main` is the only target every layout in the monorepo guarantees —
 * every root layout wraps its page in `<main id="main">`. "Skip to
 * navigation" / "Skip to help" used to be hardcoded here too, but not
 * every app (or every route within an app — e.g. a signin page outside
 * a dashboard shell) actually has a `#nav` or `#help` landmark, which
 * made those two links dead ends for keyboard/screen-reader users on
 * exactly the audience this component exists for. Pass `links` from a
 * layout that can guarantee its extra landmarks are present on every
 * page it renders.
 */
export function SkipLinks({ links = DEFAULT_LINKS }: { links?: SkipLink[] }) {
  return (
    <div className="skip-links">
      {links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
    </div>
  );
}
