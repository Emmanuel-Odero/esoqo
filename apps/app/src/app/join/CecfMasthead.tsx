import { Icon } from '@esoko/ui';

/**
 * "This is CECF, and Esoko is behind it." — the identity band above the
 * join form. The page used to read as a pure Esoko signup; the masthead
 * makes the actual membership (CECF) the headline and names Esoko as
 * the same team's economic toolbox, with a plain statement of how the
 * two share the one record — because that sharing is the honest reason
 * the tools work, and people deserve it explained before the form.
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
          <p className="cecf-kicker">A Child Elder Care Foundation membership</p>
        </div>

        <h1>Join CECF. Your household, better equipped.</h1>
        <p className="cecf-lede">
          CECF is who you join — a community that looks after this country&rsquo;s elders and
          the households that care for them. Beside your membership sits Esoko, the same
          team&rsquo;s digital toolbox: market prices, payments, receipts and a record you
          can trade with from a KES 1,000 handset.
        </p>

        <ul className="cecf-chips" aria-label="Why this membership costs nothing to start">
          <li><Icon name="check" size={14} />Free, and it stays free</li>
          <li><Icon name="check" size={14} />Works on any basic phone</li>
          <li className="ochre"><Icon name="handshake" size={14} />Your record is shared with Esoko so these tools work</li>
        </ul>
      </div>
    </header>
  );
}