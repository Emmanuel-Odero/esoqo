import Link from 'next/link';
import { Icon, type IconName } from '@esoqo/ui';

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

const PILLARS: readonly {
  number: string;
  icon: IconName;
  title: string;
  body: string;
  meta: string;
}[] = [
  {
    number: '01',
    icon: 'shop',
    title: 'A front door for your work',
    body: 'Put your products, prices and contact details on one shareable page. Customers can find you, order and pay without creating another account.',
    meta: 'Storefront included',
  },
  {
    number: '02',
    icon: 'phone-call',
    title: 'Payments that fit the counter',
    body: 'Take M-Pesa payments online, at the till, or both. The same order and customer record follows the sale wherever it happens.',
    meta: 'M-Pesa ready',
  },
  {
    number: '03',
    icon: 'chart',
    title: 'A record you can act on',
    body: 'See what sold, what is waiting and what came in. Add costs as you go, so your reports show the business behind the numbers.',
    meta: 'One source of truth',
  },
];

const STEPS: readonly { number: string; title: string; body: string }[] = [
  { number: '01', title: 'Name the business', body: 'Choose the name customers should see and add a short description of what you do.' },
  { number: '02', title: 'Choose an address', body: 'Start with a free esoko.global/@name address, or ask about a custom web address.' },
  { number: '03', title: 'Make it yours', body: 'Pick a look, add a logo and describe your work in your own words.' },
  { number: '04', title: 'Add the till', body: 'Turn on the PoS terminal when you want to ring up sales in person too.' },
  { number: '05', title: 'Open the doors', body: 'Review the details, confirm any current charges and start sharing your shop.' },
];

const SELLERS: readonly { icon: IconName; title: string; body: string; tag: string }[] = [
  { icon: 'basket', title: 'Market traders', body: 'Keep a live list, sell from the stall and let customers order ahead.', tag: 'Fast catalogue' },
  { icon: 'wheat', title: 'Farmers and makers', body: 'Tell people what you grow or make, and make the next order easier to find.', tag: 'Your story' },
  { icon: 'users', title: 'Chamas and groups', body: 'Keep the group catalogue and money movement in the same place.', tag: 'Shared record' },
  { icon: 'shop', title: 'Food and hospitality', body: 'Take orders, confirm payment and keep the counter moving when signal is low.', tag: 'PoS ready' },
];

const FAQS: readonly { question: string; answer: string }[] = [
  { question: 'Do I need a website to start?', answer: 'No. Every store starts with an esoko.global/@name address that you can share by SMS, WhatsApp or on your usual social channels.' },
  { question: 'Can I sell in person as well as online?', answer: 'Yes. The PoS terminal is optional and lets you ring up cash and M-Pesa sales while keeping them with the same business record.' },
  { question: 'What happens when a payment does not confirm?', answer: 'Esoqo does not quietly treat an unconfirmed payment as paid. The order stays visible in your dashboard so you know what needs attention.' },
  { question: 'Can I change my catalogue later?', answer: 'Always. Add products, adjust prices, change stock and update the story customers read whenever your work changes.' },
];

export default function Home() {
  return (
    <div className="store-landing">
      <div className="store-paper">
        <div className="paper-topline">
          <span>ESOQO / STORE / MERCHANT GUIDE</span>
          <span>REV. 2026.09</span>
        </div>

        <header className="paper-header">
          <Link href="/" className="paper-brand" aria-label="Esoqo Store home">
            <span className="paper-mark"><Icon name="shop" size={19} /></span>
            <span className="paper-brand-copy">
              <strong>Esoqo</strong>
              <small>Store / merchant edition</small>
            </span>
          </Link>
          <nav className="paper-nav" aria-label="Store guide">
            <a href="#overview">Overview</a>
            <a href="#how">How it works</a>
            <a href="#stories">For your work</a>
            <a href="#questions">Questions</a>
          </nav>
          <div className="paper-actions">
            <Link href="/signin" className="paper-signin">Sign in</Link>
            <Link href="/dashboard/new" className="btn btn-p btn-sm">
              Open your store <Icon name="arrow-right" size={15} />
            </Link>
          </div>
        </header>

        <section className="paper-hero" id="overview">
          <div className="paper-hero-copy">
            <p className="paper-eyebrow"><span>Esoqo Store</span><span>Field guide 01 / 04</span></p>
            <h1>Make your work easier to find, trust and run.</h1>
            <p className="paper-lede">
              One simple place for your catalogue, your payments and the record of what you sell.
              Open a storefront for customers online, add a till for the counter, and keep both
              connected to your Esoqo account.
            </p>
            <div className="paper-cta-row">
              <Link href="/dashboard/new" className="btn btn-g">
                <Icon name="plus" size={16} />Open your store
              </Link>
              <a href={`${WEB_URL}/discover`} className="paper-text-link">
                See a shop on Esoqo <Icon name="arrow-right" size={15} />
              </a>
            </div>
            <div className="paper-facts" aria-label="Store highlights">
              <span><Icon name="check-circle" size={14} />Free starting address</span>
              <span><Icon name="check-circle" size={14} />M-Pesa payments</span>
              <span><Icon name="check-circle" size={14} />Works from any phone</span>
            </div>
          </div>

          <aside className="paper-snapshot" aria-label="Example store snapshot">
            <div className="snapshot-bar">
              <span>STORE SNAPSHOT</span>
              <span className="snapshot-live"><i />Live</span>
            </div>
            <div className="snapshot-shop">
              <span className="snapshot-mark">NF</span>
              <div>
                <strong>Nia Floral House</strong>
                <span>esoko.global/@niafloral</span>
              </div>
            </div>
            <div className="snapshot-status"><span>Open for orders</span><b>09:41</b></div>
            <div className="snapshot-order">
              <div className="snapshot-order-head"><span>Latest order</span><span className="mono">#0042</span></div>
              <div className="snapshot-item"><span>Wrapped bouquet</span><b className="mono">KES 2,400</b></div>
              <div className="snapshot-item"><span>Delivery</span><b className="mono">KES 200</b></div>
              <div className="snapshot-total"><span>Paid with M-Pesa</span><b className="mono">KES 2,600</b></div>
            </div>
            <div className="snapshot-foot"><Icon name="shield-check" size={14} />Payment confirmed · Ready to dispatch</div>
          </aside>
        </section>

        <div className="paper-body">
          <aside className="paper-index" aria-label="On this page">
            <p className="index-label">On this page</p>
            <nav>
              <a className="index-link active" href="#overview"><span>00</span>Overview</a>
              <a className="index-link" href="#story"><span>01</span>One connected shop</a>
              <a className="index-link" href="#how"><span>02</span>How it works</a>
              <a className="index-link" href="#stories"><span>03</span>For your work</a>
              <a className="index-link" href="#questions"><span>04</span>Questions</a>
            </nav>
            <div className="index-note">
              <Icon name="document" size={16} />
              <p>A short guide to opening, running and sharing your Esoqo store.</p>
            </div>
          </aside>

          <article className="paper-content">
            <section className="paper-section" id="story">
              <div className="section-heading">
                <p className="section-number">01 / The idea</p>
                <h2>A small shop can have a proper front desk.</h2>
                <p className="section-intro">
                  Your business already has a name, a story and people who want to buy from you.
                  Esoqo Store gives that work one clear place online without asking you to become
                  a software company.
                </p>
              </div>
              <div className="pillar-list">
                {PILLARS.map((pillar) => (
                  <div className="pillar-row" key={pillar.number}>
                    <div className="pillar-icon"><Icon name={pillar.icon} size={21} /></div>
                    <div className="pillar-copy">
                      <div className="pillar-title"><span>{pillar.number}</span><h3>{pillar.title}</h3></div>
                      <p>{pillar.body}</p>
                    </div>
                    <span className="pillar-meta">{pillar.meta}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="paper-section" id="how">
              <div className="section-heading">
                <p className="section-number">02 / The process</p>
                <h2>From blank page to first order in five steps.</h2>
                <p className="section-intro">
                  There is no complicated setup. Answer a few plain questions, choose the parts
                  you need and keep the address you can share anywhere.
                </p>
              </div>
              <div className="process-layout">
                <ol className="process-list">
                  {STEPS.map((step) => (
                    <li key={step.number}>
                      <span className="process-number">{step.number}</span>
                      <div><h3>{step.title}</h3><p>{step.body}</p></div>
                    </li>
                  ))}
                </ol>
                <div className="process-card">
                  <div className="process-card-head"><span>OPENING CHECKLIST</span><span className="mono">READY / 05</span></div>
                  <div className="checklist-row"><span className="check-dot"><Icon name="check" size={12} /></span><span>Choose a business</span></div>
                  <div className="checklist-row"><span className="check-dot"><Icon name="check" size={12} /></span><span>Pick an address</span></div>
                  <div className="checklist-row"><span className="check-dot"><Icon name="check" size={12} /></span><span>Add your catalogue</span></div>
                  <div className="checklist-row"><span className="check-dot"><Icon name="check" size={12} /></span><span>Share your shop</span></div>
                  <Link href="/dashboard/new" className="process-link">Start the checklist <Icon name="arrow-right" size={15} /></Link>
                </div>
              </div>
            </section>

            <section className="paper-section" id="stories">
              <div className="section-heading">
                <p className="section-number">03 / The storefront</p>
                <h2>A shop page that does more than show a picture.</h2>
                <p className="section-intro">
                  Your page is where a customer learns what you sell, asks a question and completes
                  an order. Keep it simple, keep it yours and let the payment step be familiar.
                </p>
              </div>
              <div className="storefront-layout">
                <div className="storefront-copy">
                  <div className="copy-callout">
                    <span className="callout-rule" />
                    <p>“A clear catalogue is a shortcut to trust.”</p>
                  </div>
                  <ul className="check-list">
                    <li><Icon name="check" size={15} /><span><strong>Share anywhere.</strong> Send your esoko.global address by SMS, WhatsApp or print it on a card.</span></li>
                    <li><Icon name="check" size={15} /><span><strong>Keep payment familiar.</strong> Customers confirm with M-Pesa, with the same details shown before they pay.</span></li>
                    <li><Icon name="check" size={15} /><span><strong>Show the real state.</strong> Products, options, stock and fulfilment choices stay in the open.</span></li>
                  </ul>
                </div>
                <div className="storefront-preview" aria-label="Example storefront preview">
                  <div className="preview-window-bar"><span /><span /><span /><b>esoko.global/@niafloral</b></div>
                  <div className="preview-cover">
                    <div className="preview-cover-copy"><span>FRESH THIS MORNING</span><strong>Flowers for the people who matter.</strong></div>
                    <div className="preview-cover-mark">NF</div>
                  </div>
                  <div className="preview-products">
                    <div className="preview-product"><span className="preview-thumb"><Icon name="leaf" size={18} /></span><span><strong>Wrapped bouquet</strong><small>Ready today</small></span><b className="mono">2,400</b></div>
                    <div className="preview-product"><span className="preview-thumb pink"><Icon name="leaf" size={18} /></span><span><strong>Table centrepiece</strong><small>Made to order</small></span><b className="mono">3,200</b></div>
                    <div className="preview-product"><span className="preview-thumb amber"><Icon name="leaf" size={18} /></span><span><strong>Event bundle</strong><small>Ask for a quote</small></span><b className="mono">6,500</b></div>
                  </div>
                  <div className="preview-footer"><span>Pay with M-Pesa</span><span>Delivery available</span></div>
                </div>
              </div>
            </section>

            <div className="seller-intro">
              <div>
                <p className="section-number">04 / Made for real work</p>
                <h2>Different work. One familiar way to sell.</h2>
              </div>
              <p>Start with the page that fits your work today. Add the next piece when you are ready.</p>
            </div>
            <div className="seller-grid">
              {SELLERS.map((seller) => (
                <div className="seller-card" key={seller.title}>
                  <div className="seller-card-top"><span className="seller-icon"><Icon name={seller.icon} size={19} /></span><span className="seller-tag">{seller.tag}</span></div>
                  <h3>{seller.title}</h3>
                  <p>{seller.body}</p>
                </div>
              ))}
            </div>

            <section className="paper-section trust-section" id="trust">
              <div className="trust-panel">
                <div className="trust-copy">
                  <p className="section-number">05 / The useful part</p>
                  <h2>Clear enough for a customer. Quiet enough for you.</h2>
                  <p>Every sale has a place, a status and a next step. That is the difference between a busy counter and a business you can understand at the end of the day.</p>
                  <Link href="/dashboard" className="paper-text-link">Go to your dashboard <Icon name="arrow-right" size={15} /></Link>
                </div>
                <div className="trust-list">
                  <div><span className="trust-icon"><Icon name="phone-call" size={18} /></span><span><strong>Pay your way</strong><small>M-Pesa online, at the till, or cash on delivery when available.</small></span></div>
                  <div><span className="trust-icon"><Icon name="box" size={18} /></span><span><strong>Know what is next</strong><small>Orders stay visible from payment through fulfilment.</small></span></div>
                  <div><span className="trust-icon"><Icon name="chart" size={18} /></span><span><strong>Learn from the record</strong><small>Track sales, costs and stock to make the next decision.</small></span></div>
                </div>
              </div>
            </section>

            <section className="paper-section" id="questions">
              <div className="section-heading questions-heading">
                <p className="section-number">06 / Good questions</p>
                <h2>The short answers, before you begin.</h2>
              </div>
              <div className="faq-list">
                {FAQS.map((faq) => (
                  <details className="faq-item" key={faq.question}>
                    <summary><span>{faq.question}</span><Icon name="chevron-down" size={17} /></summary>
                    <p>{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>

            <section className="paper-cta" id="start">
              <div>
                <p className="section-number">Ready when you are</p>
                <h2>Give your work a place people can find.</h2>
                <p>Open a store, choose your address and start with the part you need today.</p>
              </div>
              <Link href="/dashboard/new" className="btn btn-g">Open your store <Icon name="arrow-right" size={16} /></Link>
            </section>
          </article>
        </div>

        <footer className="paper-footer">
          <div className="paper-footer-brand"><span className="paper-mark small"><Icon name="shop" size={16} /></span><span><strong>Esoqo Store</strong><small>Business tools for the everyday economy.</small></span></div>
          <div className="paper-footer-links"><a href={`${WEB_URL}/discover`}>Browse shops</a><Link href="/signin">Sign in</Link><a href="#overview">Back to top</a></div>
          <span className="mono">01 / 04</span>
        </footer>
      </div>
    </div>
  );
}
