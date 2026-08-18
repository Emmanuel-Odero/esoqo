import { Icon } from '@esoko/ui';

/**
 * The "why join" column, for esoko's own membership. Previously
 * reframed around a CECF-led page ("CECF is who you join"); this flow
 * is esoko's own registration now, so the copy speaks for esoko
 * directly rather than the toolkit behind someone else's membership.
 */
export function WhyJoin() {
  return (
    <section className="join-hero" aria-labelledby="why-join-h">
      <p className="join-hero-eyebrow">Your membership carries</p>
      <h2 id="why-join-h">A record you can trade with</h2>
      <p className="lede">
        One registration — for yourself, your group or your business — opens Esoko&rsquo;s
        tools straight away: market prices, payments and receipts, and a history that
        works for you with a bank or a buyer.
      </p>
      <ul className="join-points">
        <li>
          <span className="icbox"><Icon name="basket" size={18} /></span>
          <span>
            <strong>One record opens a trade</strong>
            <span className="d">Prices, payments and — for registered traders — a storefront, with no second signup.</span>
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
          <span className="icbox"><Icon name="seal" size={18} /></span>
          <span>
            <strong>Formal recognition, when you want it</strong>
            <span className="d">Track group and business registration status, KRA PIN and more on the same record.</span>
          </span>
        </li>
        <li>
          <span className="icbox"><Icon name="check-circle" size={18} /></span>
          <span>
            <strong>Free, and it stays free</strong>
            <span className="d">No subscription. Government fees, when they apply, are paid directly to the issuing office.</span>
          </span>
        </li>
      </ul>
    </section>
  );
}
