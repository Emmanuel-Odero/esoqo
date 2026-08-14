import { Icon } from '@esoko/ui';

/**
 * "This is CECF, and Esoko is behind it." — the identity band above the
 * join form. The page used to read as a pure Esoko signup; the masthead
 * makes the actual membership (CECF) the headline and names Esoko as
 * the same team's economic toolbox, with a plain statement of how the
 * two share the one record — because that sharing is the honest reason
 * the tools work, and people deserve it explained before the form.
 *
 * The copy here matches what CECF actually is on childeldercare.test —
 * a foundation that takes Kenya's grassroots groups (chamas, table
 * banking groups, CBOs, welfare associations) and MSMEs from informal
 * to formally recognised, then connects them to banks, buyers and
 * government services. It is not a household elder-care charity —
 * despite the name — and this page previously described it as one.
 */
export function CecfMasthead() {
  return (
    <header className="cecf-masthead">
      <div className="cecf-masthead-inner">
        <div className="cecf-masthead-top">
          <span className="cecf-emblem" aria-hidden="true">
            <span className="cecf-emblem-ring">
              <Icon name="handshake" size={26} />
            </span>
            <Icon name="leaf" size={13} className="cecf-emblem-leaf leaf-l" />
            <Icon name="leaf" size={11} className="cecf-emblem-leaf leaf-r" />
          </span>
          <p className="cecf-kicker">A Child &amp; Elder Care Foundation membership</p>
        </div>

        <h1>Join CECF. Every group deserves to be counted.</h1>
        <p className="cecf-lede">
          CECF is who you join — a Kenyan foundation that takes grassroots groups and
          MSMEs from informal to formally recognised, then connects them to the banks,
          buyers and government services that recognition unlocks. Beside your
          membership sits Esoko, the same team&rsquo;s digital toolbox: market prices,
          payments, receipts and a record you can trade with.
        </p>

        <ul className="cecf-chips" aria-label="Why this membership costs nothing to start">
          <li><Icon name="check" size={14} />Free, and it stays free</li>
          <li><Icon name="check" size={14} />For groups, MSMEs and individuals alike</li>
          <li className="ochre"><Icon name="handshake" size={14} />Your record is shared with Esoko so these tools work</li>
        </ul>
      </div>
    </header>
  );
}