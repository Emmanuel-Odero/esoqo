import { Icon } from '@esoko/ui';

/**
 * "Why join" copy — grounded in what the product actually does (see
 * root README.md and packages/domain), not aspirational marketing:
 * one consented record, reachable from a basic handset, that a
 * registered trader can also sell through without a second signup.
 */
export function WhyEsoko() {
  return (
    <section className="cecf-hero" aria-labelledby="why-esoko-h">
      <p className="cecf-hero-eyebrow">Before you start</p>
      <h2 id="why-esoko-h">One record. Yours to show, or not.</h2>
      <p className="lede">
        Esoko holds a trader, chama or small business&rsquo;s registrations,
        permits and trading record in one place — reachable from a KES
        1,000 handset, and readable by no one you haven&rsquo;t agreed
        to show it to.
      </p>
      <ul className="cecf-points">
        <li>
          <span className="icbox"><Icon name="shield" size={18} /></span>
          <span>
            <strong>You decide who sees it</strong>
            <span className="d">Every credential is consented, every time — nothing is shared by default.</span>
          </span>
        </li>
        <li>
          <span className="icbox"><Icon name="check" size={18} /></span>
          <span>
            <strong>Free, and it stays free</strong>
            <span className="d">No subscription, no hidden fee for holding your own record.</span>
          </span>
        </li>
        <li>
          <span className="icbox"><Icon name="basket" size={18} /></span>
          <span>
            <strong>One account, a storefront too</strong>
            <span className="d">A registered trader can open a store — checkout and PoS included — with no separate signup.</span>
          </span>
        </li>
      </ul>
    </section>
  );
}
