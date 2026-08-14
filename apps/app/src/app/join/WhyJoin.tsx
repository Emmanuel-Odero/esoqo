import { Icon } from '@esoko/ui';

/**
 * The "why join" column — reframed for a CECF-led page. What people are
 * actually signing up for is a CECF membership; what Esoko contributes
 * is the toolkit the membership can trade and save with. The copy stays
 * grounded (one consented record, formal recognition, no fee) rather
 * than aspirational — and matches what CECF actually does per
 * childeldercare.test: taking grassroots groups and MSMEs from informal
 * to formally recognised, not household elder care.
 */
export function WhyJoin() {
  return (
    <section className="cecf-hero" aria-labelledby="why-join-h">
      <p className="cecf-hero-eyebrow">Your membership carries</p>
      <h2 id="why-join-h">Formal recognition, and the tools to trade with it</h2>
      <p className="lede">
        CECF takes grassroots groups and MSMEs from informal to formally recognised, and
        connects them to the banks, buyers and government services that unlocks. Your one
        membership record also opens Esoko&rsquo;s tools — prices, payments and receipts —
        so the same record that gets you counted can earn for you.
      </p>
      <ul className="cecf-points">
        <li>
          <span className="icbox"><Icon name="seal" size={18} /></span>
          <span>
            <strong>A CECF membership</strong>
            <span className="d">Support getting your group or business registered, plus dispute mediation and government services.</span>
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