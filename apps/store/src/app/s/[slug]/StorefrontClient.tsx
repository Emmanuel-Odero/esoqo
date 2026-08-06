'use client';

import { useMemo, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { checkout } from './actions';

interface Product { id: string; name: string; priceKes: number; stockQty: number | null }
interface StoreInfo { slug: string; name: string; themeKey: string }

const THEME_ACCENTS: Record<string, { accent: string; tint: string }> = {
  market: { accent: '#12794A', tint: '#E7F4ED' },
  nairobi: { accent: '#0F5C9E', tint: '#E9F2F9' },
  sundown: { accent: '#B8760B', tint: '#FDF4E3' },
  slate: { accent: '#57718A', tint: '#DCE5EC' },
};

const DISCOVER_URL = `${process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'}/discover`;
const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export function StorefrontClient({ store, products }: { store: StoreInfo; products: Product[] }) {
  const theme = THEME_ACCENTS[store.themeKey] ?? THEME_ACCENTS.market!;
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'browsing' | 'form' | 'waiting' | 'success' | 'error'>('browsing');
  const [buyerName, setBuyerName] = useState('');
  const [buyerMsisdn, setBuyerMsisdn] = useState('+254 7');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const t = query.trim().toLowerCase();
    return t ? products.filter((p) => p.name.toLowerCase().includes(t)) : products;
  }, [products, query]);

  const items = useMemo(
    () => Object.entries(cart).map(([productId, quantity]) => ({ product: products.find((p) => p.id === productId)!, quantity })).filter((i) => i.product),
    [cart, products],
  );
  const total = items.reduce((sum, i) => sum + i.product.priceKes * i.quantity, 0);
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  function setQty(productId: string, qty: number) {
    setCart((c) => {
      if (qty <= 0) {
        const rest = { ...c };
        delete rest[productId];
        return rest;
      }
      return { ...c, [productId]: qty };
    });
  }

  function submitCheckout() {
    setError(null);
    startTransition(async () => {
      const result = await checkout({
        storeSlug: store.slug,
        buyerName,
        buyerMsisdn: buyerMsisdn.replace(/\s+/g, ''),
        items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
      });
      if (!result.ok) { setError(result.error); setStage('error'); return; }
      setStage(result.data.status === 'PAID' ? 'success' : 'waiting');
    });
  }

  return (
    <div className="sf" style={{ ['--sf-accent' as string]: theme.accent, ['--sf-accent-t' as string]: theme.tint }}>
      <div className="sf-hero">
        <div className="sf-wrap">
          <a className="sf-back" href={DISCOVER_URL}><Icon name="arrow-left" size={14} />All shops on Esoko</a>
          <div className="sf-hero-row">
            <div>
              <p className="sf-kicker">Esoko store</p>
              <h1>{store.name}</h1>
              <p className="addr mono">esoko.global/@{store.slug}</p>
            </div>
            <button type="button" className="sf-cart-btn" onClick={() => setCartOpen(true)} aria-label={`Basket, ${cartCount} items`}>
              <Icon name="basket" size={19} />
              {cartCount > 0 && <span className="n">{cartCount}</span>}
            </button>
          </div>
        </div>
      </div>

      <div className="sf-wrap" style={{ paddingBottom: 60 }}>
        {products.length === 0 ? (
          <div className="sf-empty">
            <span className="icbox"><Icon name="box" size={22} /></span>
            <h3 style={{ marginBottom: 6 }}>Nothing listed yet</h3>
            <p style={{ color: 'var(--tx-2)', margin: 0 }}>{store.name} hasn&apos;t added products. Check back soon.</p>
          </div>
        ) : (
          <>
            {products.length > 6 && (
              <div className="sf-toolbar">
                <div className="sf-search">
                  <span className="mg"><Icon name="search" size={16} /></span>
                  <input
                    type="search" placeholder={`Search ${store.name}`}
                    value={query} onChange={(e) => setQuery(e.target.value)}
                    aria-label={`Search products in ${store.name}`}
                  />
                </div>
              </div>
            )}

            <div className="sf-plist">
              {visible.map((p) => {
                const qty = cart[p.id] ?? 0;
                return (
                  <div className="sf-prow" key={p.id}>
                    <div>
                      <span className="sf-prow-nm">{p.name}</span>
                      {p.stockQty !== null && p.stockQty <= 5 && (
                        <span className="sf-prow-stock">{p.stockQty === 0 ? 'Out of stock' : `Only ${p.stockQty} left`}</span>
                      )}
                    </div>
                    <div className="sf-prow-side">
                      <span className="sf-prow-price">{kes(p.priceKes)}</span>
                      {qty === 0 ? (
                        <button type="button" className="sf-add" onClick={() => setQty(p.id, 1)} aria-label={`Add ${p.name} to basket`}>
                          <Icon name="plus" size={16} />
                        </button>
                      ) : (
                        <div className="sf-stepper">
                          <button type="button" onClick={() => setQty(p.id, qty - 1)} aria-label={`Remove one ${p.name}`}>−</button>
                          <span className="q">{qty}</span>
                          <button type="button" onClick={() => setQty(p.id, qty + 1)} aria-label={`Add one more ${p.name}`}>+</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {cartOpen && (
        <div role="dialog" aria-label="Your basket" style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
          <button
            type="button"
            aria-label="Close basket"
            onClick={() => setCartOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(10,20,30,.45)', border: 0, cursor: 'default' }}
          />
          <div
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 'min(420px, 92vw)', background: '#fff', padding: 24, display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: 'var(--sh-l)' }}
          >
            {stage === 'browsing' && (
              <>
                <h2 style={{ fontSize: '1.1rem', marginBottom: 14 }}>Your basket</h2>
                {items.length === 0 ? <p style={{ color: 'var(--tx-2)' }}>Nothing added yet.</p> : items.map((i) => (
                  <div className="cart-row" key={i.product.id}>
                    <span>{i.product.name} ×{i.quantity}</span>
                    <b className="mono">{kes(i.product.priceKes * i.quantity)}</b>
                  </div>
                ))}
                <div className="cart-total"><span>Total</span><span className="mono">{kes(total)}</span></div>
                <button type="button" className="btn btn-g" disabled={items.length === 0} onClick={() => setStage('form')}>
                  Checkout with M-Pesa <Icon name="arrow-right" size={16} />
                </button>
                <button type="button" className="btn btn-o" style={{ marginTop: 8 }} onClick={() => setCartOpen(false)}>Keep shopping</button>
              </>
            )}

            {stage === 'form' && (
              <>
                <h2 style={{ fontSize: '1.1rem', marginBottom: 14 }}>Confirm &amp; pay</h2>
                <div className="co-summary">
                  {items.map((i) => <div className="row3" key={i.product.id}><span>{i.product.name} ×{i.quantity}</span><span>{kes(i.product.priceKes * i.quantity)}</span></div>)}
                  <div className="row3 tot"><span>Total</span><span>{kes(total)}</span></div>
                </div>
                <div className="fld">
                  <label className="lab" htmlFor="bname">Your name</label>
                  <input className="inp" id="bname" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                </div>
                <div className="fld">
                  <label className="lab" htmlFor="bmsisdn">M-Pesa number</label>
                  <input className="inp mono" id="bmsisdn" value={buyerMsisdn} onChange={(e) => setBuyerMsisdn(e.target.value)} inputMode="tel" />
                </div>
                <button type="button" className="btn btn-g" style={{ width: '100%' }} disabled={pending || !buyerName.trim() || !buyerMsisdn.trim()} onClick={submitCheckout}>
                  {pending ? 'Sending prompt…' : `Pay ${kes(total)}`}
                </button>
                <button type="button" className="btn btn-o" style={{ marginTop: 8 }} onClick={() => setStage('browsing')}>Back to basket</button>
              </>
            )}

            {stage === 'waiting' && (
              <div style={{ textAlign: 'center', paddingTop: 40 }}>
                <div className="co-phone"><span className="co-pulse" /><Icon name="phone-call" size={26} /></div>
                <h2 style={{ fontSize: '1rem' }}>Check your phone</h2>
                <p style={{ color: 'var(--tx-2)', fontSize: '.86rem', marginTop: 6 }}>
                  We&apos;ve sent a payment prompt to {buyerMsisdn}. Enter your M-Pesa PIN to complete.
                </p>
              </div>
            )}

            {stage === 'success' && (
              <div style={{ textAlign: 'center', paddingTop: 40 }}>
                <div className="co-success"><Icon name="check" size={30} /></div>
                <h2 style={{ fontSize: '1rem' }}>Payment received</h2>
                <p style={{ color: 'var(--tx-2)', fontSize: '.86rem', marginTop: 6 }}>
                  {`${store.name} has been notified. You'll get an SMS when your order is ready.`}
                </p>
                <button type="button" className="btn btn-o" style={{ marginTop: 20 }} onClick={() => { setCartOpen(false); setCart({}); setStage('browsing'); }}>
                  Done
                </button>
              </div>
            )}

            {stage === 'error' && (
              <div style={{ paddingTop: 20 }}>
                <div className="note n-red"><div><p>{error}</p></div></div>
                <button type="button" className="btn btn-o" onClick={() => setStage('form')}>Try again</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}