import { Icon } from '@esoqo/ui';

/**
 * "This is Esoqo, and here's what your membership carries." Replaces
 * the earlier CECF-led masthead — that framing made sense while this
 * page was CECF's own front door; now CECF runs its own registration
 * on childeldercare.test, and this page is esoqo's own membership: a
 * record you can trade with — prices, payments, receipts.
 */
export function JoinMasthead() {
  return (
    <header className="join-masthead">
      <div className="join-masthead-inner">
        <div className="join-masthead-top">
          <span className="join-emblem" aria-hidden="true">
            <span className="join-emblem-ring">
              <Icon name="basket" size={26} />
            </span>
            <Icon name="check-circle" size={13} className="join-emblem-mark mark-l" />
          </span>
          <p className="join-kicker">An Esoqo membership</p>
        </div>

        <h1>Join Esoqo. Get counted, get the tools.</h1>
        <p className="join-lede">
          One record for who you are and what you do — a trader, a group, an MSME.
          It opens Esoqo&rsquo;s tools straight away: market prices, payments and
          receipts, and a history you can put in front of a bank or a buyer.
        </p>

        <ul className="join-chips" aria-label="Why this membership costs nothing to start">
          <li><Icon name="check" size={14} />Free, and it stays free</li>
          <li><Icon name="check" size={14} />For groups, MSMEs and individuals alike</li>
          <li className="accent"><Icon name="shield-check" size={14} />Your record, shared only when you say so</li>
        </ul>
      </div>
    </header>
  );
}
