import { Logo } from '@esoqo/ui';

export function SiteFooter() {
  return (
    <footer className="mainfooter">
      <div className="wrap">
        <b>Our Jamii</b> — CECF Community Pages. Every organisation shown here has its own page,
        run by its own people.
        <div className="poweredby">
          <span>Powered by</span>
          <Logo />
        </div>
      </div>
    </footer>
  );
}
