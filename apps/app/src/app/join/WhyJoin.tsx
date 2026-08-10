import { Icon } from '@esoko/ui';

/**
 * The "why join" column — reframed for a CECF-led page. What people are
 * actually signing up for is a CECF membership; what Esoko contributes
 * is the toolkit the membership can trade and save with. The copy stays
 * grounded (one consented record, reachable from a basic handset) rather
 * than aspirational.
 */
export function WhyJoin() {
  return (
    <section className="cecf-hero" aria-labelledby="why-join-h">
      <p className="cecf-hero-eyebrow">Your membership carries</p>
      <h2 id="why-join-h">Care, and the tools to trade with it</h2>
      <p className="lede">
        CECF looks after elders and the households that care for them. Your one membership
        record also opens Esoko&rsquo;s tools — prices, payments and receipts — so the same
        record that places you in the community can earn for you.
      </p>
      <ul className="cecf-points">
        <li>
          <span className="icbox"><Icon name="seal" size={18} /></span>
          <span>
            <strong>A CECF membership</strong>
            <span className="d">Community support, visits and a shared safety net for the people you care for.</span>
          </span>
        </li>
        <li>
          <span className="icbox"><Icon name="shield-check" size={18} /></span>
          <span>
            <strong>You decide who sees it</strong>
            <span className="d">Every credential is consented, every time — nothing is shared by default.</span>
          </span>
        </li>
        <li>
          <span className="icbox"><Icon name="basket" size={18} /></span>
          <span>
            <strong>One record opens a trade</strong>
            <span className="d">Prices, payments and — for registered traders — a storefront, with no second signup.</span>
          </span>
        </li>
        <li>
          <span className="icbox"><Icon name="keypad" size={18} /></span>
          <span>
            <strong>Free, on any handset</strong>
            <span className="d">No subscription. Reachable by dialling <strong className="mono">*483*77#</strong> from a basic phone.</span>
          </span>
        </li>
      </ul>
    </section>
  );
}