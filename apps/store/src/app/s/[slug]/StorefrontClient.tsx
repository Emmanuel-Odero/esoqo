'use client';

import { useMemo, useState, useTransition } from 'react';
import { Icon, type IconName } from '@esoko/ui';
import { PRODUCT_CATEGORIES } from '@esoko/domain';
import { checkout } from './actions';

interface Variant { id: string; label: string; priceKes: number; stockQty: number | null }
interface Product {
  id: string; name: string; category: string | null; priceKes: number; stockQty: number | null;
  imageUrl: string | null; variants: Variant[];
}
interface FulfilmentOption { id: string; kind: 'PICKUP' | 'DELIVERY'; label: string; feeKes: number }
interface StoreInfo { slug: string; name: string; themeKey: string }

const THEME_ACCENTS: Record<string, { accent: string; tint: string }> = {
  market: { accent: '#12794A', tint: '#E7F4ED' },
  nairobi: { accent: '#0F5C9E', tint: '#E9F2F9' },
  sundown: { accent: '#B8760B', tint: '#FDF4E3' },
  slate: { accent: '#57718A', tint: '#DCE5EC' },
};

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(PRODUCT_CATEGORIES);

const CATEGORY_ICON: Record<string, IconName> = {
  FOOD_GROCERIES: 'leaf',
  AGRICULTURE: 'wheat',
  HEALTH_BEAUTY: 'star',
  BUILDING_MATERIALS: 'box',
  ELECTRONICS: 'plug',
  FASHION_APPAREL: 'tag',
  HOME_FURNITURE: 'shop',
  HARDWARE_TOOLS: 'grid',
  AUTOMOTIVE: 'truck',
  SERVICES: 'handshake',
  OTHER: 'basket',
};

const DISCOVER_URL = `${process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'}/discover`;
const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

/** A cart line is keyed by product id, or `${productId}:${variantId}` when
 *  the product sells by variant — two different sizes of the same item
 *  are two different lines. */
interface CartLine { productId: string; variantId: string | null; quantity: number }

export function StorefrontClient({ store, products, fulfilmentOptions }: {
  store: StoreInfo; products: Product[]; fulfilmentOptions: FulfilmentOption[];
}) {
  const theme = THEME_ACCENTS[store.themeKey] ?? THEME_ACCENTS.market!;
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [pickingVariantFor, setPickingVariantFor] = useState<Product | null>(null);
  const [deliveryOptionId, setDeliveryOptionId] = useState<string | null>(null);
  const [collectionNotes, setCollectionNotes] = useState('');
  const [stage, setStage] = useState<'browsing' | 'form' | 'waiting' | 'success' | 'error'>('browsing');
  const [buyerName, setBuyerName] = useState('');
  const [buyerMsisdn, setBuyerMsisdn] = useState('+254 7');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))], [products]);

  const visible = useMemo(() => {
    const t = query.trim().toLowerCase();
    return products.filter((p) =>
      (!t || p.name.toLowerCase().includes(t)) && (!category || p.category === category));
  }, [products, query, category]);

  const grouped = useMemo(() => {
    if (category) return [{ label: null, items: visible }];
    const groups = new Map<string, { label: string; items: Product[] }>();
    for (const p of visible) {
      const key = p.category ?? '';
      const label = key ? CATEGORY_LABEL[key] ?? key : 'Everything';
      if (!groups.has(key)) groups.set(key, { label, items: [] });
      groups.get(key)!.items.push(p);
    }
    return [...groups.values()];
  }, [visible, category]);

  function lineKey(productId: string, variantId: string | null) {
    return variantId ? `${productId}:${variantId}` : productId;
  }

  const items = useMemo(() => Object.values(cart).map((line) => {
    const product = products.find((p) => p.id === line.productId)!;
    const variant = line.variantId ? product?.variants.find((v) => v.id === line.variantId) : undefined;
    return { product, variant, quantity: line.quantity };
  }).filter((i) => i.product), [cart, products]);

  const basketKes = items.reduce((sum, i) => sum + (i.variant?.priceKes ?? i.product.priceKes) * i.quantity, 0);
  const deliveryOption = fulfilmentOptions.find((f) => f.id === deliveryOptionId);
  const total = basketKes + (deliveryOption?.feeKes ?? 0);
  const cartCount = Object.values(cart).reduce((a, b) => a + b.quantity, 0);

  function setQty(productId: string, variantId: string | null, qty: number) {
    const key = lineKey(productId, variantId);
    setCart((c) => {
      if (qty <= 0) { const rest = { ...c }; delete rest[key]; return rest; }
      return { ...c, [key]: { productId, variantId, quantity: qty } };
    });
  }

  function addToCart(p: Product) {
    if (p.variants.length > 0) { setPickingVariantFor(p); return; }
    setQty(p.id, null, (cart[lineKey(p.id, null)]?.quantity ?? 0) + 1);
  }

  function submitCheckout() {
    setError(null);
    startTransition(async () => {
      const result = await checkout({
        storeSlug: store.slug,
        buyerName,
        buyerMsisdn: buyerMsisdn.replace(/\s+/g, ''),
        items: items.map((i) => ({ productId: i.product.id, variantId: i.variant?.id ?? null, quantity: i.quantity })),
        deliveryOptionId,
        collectionNotes,
      });
      if (!result.ok) { setError(result.error); setStage('error'); return; }
      setStage(result.data.status === 'PAID' ? 'success' : 'waiting');
    });
  }

  return (
    <div className="sf" style={{ ['--sf-accent' as string]: theme.accent, ['--sf-accent-t' as string]: theme.tint }}>
      <div className="sf-hero">
        <div className="sf-glow" aria-hidden="true" />
        <div className="sf-wrap">
          <a className="sf-back" href={DISCOVER_URL}><Icon name="arrow-left" size={14} />All shops on Esoko</a>
          <div className="sf-hero-row">
            <div className="sf-ident">
              <span className="sf-monogram" style={{ ['--sf-accent' as string]: theme.accent }}>{store.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <p className="sf-kicker"><span className="sf-dot" style={{ background: theme.accent }} />Esoko store</p>
                <h1>{store.name}</h1>
                <p className="addr mono">esoko.global/@{store.slug}</p>
              </div>
            </div>
            <button type="button" className="sf-cart-btn" onClick={() => setCartOpen(true)} aria-label={`Basket, ${cartCount} items`}>
              <Icon name="basket" size={19} />
              {cartCount > 0 && <span className="n">{cartCount}</span>}
            </button>
          </div>
          <div className="sf-trust">
            <span className="sf-trust-chip"><Icon name="phone-call" size={13} />Pay with M-Pesa</span>
            {fulfilmentOptions.length > 0 && (
              <span className="sf-trust-chip">
                <Icon name={fulfilmentOptions.some((f) => f.kind === 'DELIVERY') ? 'truck' : 'shop'} size={13} />
                {fulfilmentOptions.some((f) => f.kind === 'DELIVERY') ? 'Delivery available' : 'Pickup available'}
              </span>
            )}
            {products.length > 0 && (
              <span className="sf-trust-chip"><Icon name="box" size={13} />{products.length} item{products.length !== 1 ? 's' : ''}</span>
            )}
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
            <div className="sf-toolbar">
              {products.length > 6 && (
                <div className="sf-search">
                  <span className="mg"><Icon name="search" size={16} /></span>
                  <input
                    type="search" placeholder={`Search ${store.name}`}
                    value={query} onChange={(e) => setQuery(e.target.value)}
                    aria-label={`Search products in ${store.name}`}
                  />
                </div>
              )}
              {categories.length > 1 && (
                <div className="sf-chips" role="group" aria-label="Filter by category">
                  <button type="button" className="sf-chip" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
                  {categories.map((c) => (
                    <button type="button" key={c} className="sf-chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                      {CATEGORY_LABEL[c] ?? c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="sf-hint">{visible.length} item{visible.length !== 1 ? 's' : ''}{category ? ` in ${CATEGORY_LABEL[category] ?? category}` : ' in this shop'}</p>

            {grouped.map((group) => (
              <section key={group.label ?? 'all'} className="sf-sect">
                {group.label && <h2 className="sf-sect-h">{group.label}</h2>}
                <div className="sf-grid">
                  {group.items.map((p) => {
                    const qty = p.variants.length === 0 ? (cart[lineKey(p.id, null)]?.quantity ?? 0) : null;
                    const outOfStock = p.variants.length > 0
                      ? p.variants.every((v) => v.stockQty !== null && v.stockQty <= 0)
                      : p.stockQty !== null && p.stockQty <= 0;
                    const minPrice = p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.priceKes)) : p.priceKes;
                    return (
                      <div className="sf-card" key={p.id}>
                        <div className="sf-card-media">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} loading="lazy" />
                          ) : (
                            <div className="sf-ph" aria-hidden="true">
                              <span className="sf-ph-ic"><Icon name={CATEGORY_ICON[p.category ?? 'OTHER'] ?? 'basket'} size={26} /></span>
                            </div>
                          )}
                          {outOfStock
                            ? <span className="sf-badge sf-badge-oos">Out of stock</span>
                            : p.variants.length === 0 && p.stockQty !== null && p.stockQty <= 5 && p.stockQty > 0
                              ? <span className="sf-badge sf-badge-low">Only {p.stockQty} left</span>
                              : p.variants.length > 0 ? <span className="sf-badge">{p.variants.length} option{p.variants.length === 1 ? '' : 's'}</span> : null}
                        </div>
                        <div className="sf-card-body">
                          <span className="sf-card-nm">{p.name}</span>
                          <div className="sf-card-row">
                            <span className="sf-card-price mono">
                              {p.variants.length > 0 && <em>from </em>}{kes(minPrice)}
                            </span>
                            {outOfStock ? (
                              <span className="sf-card-off">Sold out</span>
                            ) : p.variants.length > 0 ? (
                              <button type="button" className="sf-add" onClick={() => setPickingVariantFor(p)} aria-label={`Choose an option for ${p.name}`}>
                                <Icon name="plus" size={16} />
                              </button>
                            ) : qty === 0 ? (
                              <button type="button" className="sf-add" onClick={() => addToCart(p)} aria-label={`Add ${p.name} to basket`}>
                                <Icon name="plus" size={16} />
                              </button>
                            ) : (
                              <div className="sf-stepper">
                                <button type="button" onClick={() => setQty(p.id, null, (qty ?? 0) - 1)} aria-label={`Remove one ${p.name}`}>−</button>
                                <span className="q">{qty}</span>
                                <button type="button" onClick={() => setQty(p.id, null, (qty ?? 0) + 1)} aria-label={`Add one more ${p.name}`}>+</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      {pickingVariantFor && (
        <div role="dialog" aria-label={`Choose an option for ${pickingVariantFor.name}`} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(10,20,30,.45)' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(360px, 92vw)' }}>
            <h3 style={{ marginBottom: 12 }}>{pickingVariantFor.name}</h3>
            {pickingVariantFor.variants.map((v) => {
              const out = v.stockQty !== null && v.stockQty <= 0;
              return (
                <button
                  key={v.id} type="button" className="opt" disabled={out}
                  style={{ width: '100%', marginBottom: 8, opacity: out ? 0.5 : 1 }}
                  onClick={() => { setQty(pickingVariantFor.id, v.id, (cart[lineKey(pickingVariantFor.id, v.id)]?.quantity ?? 0) + 1); setPickingVariantFor(null); }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>{v.label}{out ? ' — out of stock' : ''}</span>
                    <b className="mono">{kes(v.priceKes)}</b>
                  </span>
                </button>
              );
            })}
            <button type="button" className="btn btn-o" style={{ width: '100%', marginTop: 6 }} onClick={() => setPickingVariantFor(null)}>Cancel</button>
          </div>
        </div>
      )}

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
                  <div className="cart-row" key={lineKey(i.product.id, i.variant?.id ?? null)}>
                    <span>{i.product.name}{i.variant ? ` — ${i.variant.label}` : ''} ×{i.quantity}</span>
                    <b className="mono">{kes((i.variant?.priceKes ?? i.product.priceKes) * i.quantity)}</b>
                  </div>
                ))}
                <div className="cart-total"><span>Total</span><span className="mono">{kes(basketKes)}</span></div>
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
                  {items.map((i) => <div className="row3" key={lineKey(i.product.id, i.variant?.id ?? null)}><span>{i.product.name}{i.variant ? ` — ${i.variant.label}` : ''} ×{i.quantity}</span><span>{kes((i.variant?.priceKes ?? i.product.priceKes) * i.quantity)}</span></div>)}
                  {deliveryOption && <div className="row3"><span>{deliveryOption.label}</span><span>{kes(deliveryOption.feeKes)}</span></div>}
                  <div className="row3 tot"><span>Total</span><span>{kes(total)}</span></div>
                </div>

                {fulfilmentOptions.length > 0 && (
                  <div className="fld">
                    <p className="lab">How would you like it?</p>
                    {fulfilmentOptions.map((f) => (
                      <button
                        type="button" key={f.id} className="opt" aria-pressed={deliveryOptionId === f.id}
                        style={{ width: '100%', marginBottom: 6 }}
                        onClick={() => setDeliveryOptionId(deliveryOptionId === f.id ? null : f.id)}
                      >
                        <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                          <span>{f.kind === 'PICKUP' ? <Icon name="shop" size={14} /> : <Icon name="truck" size={14} />} {f.label}</span>
                          <span className="mono">{f.feeKes > 0 ? kes(f.feeKes) : 'Free'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {deliveryOptionId && (
                  <div className="fld">
                    <label className="lab" htmlFor="conotes">Notes for the shop (optional)</label>
                    <input className="inp" id="conotes" value={collectionNotes} onChange={(e) => setCollectionNotes(e.target.value)} placeholder="Hand to security at gate three" />
                  </div>
                )}

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
                <button type="button" className="btn btn-o" style={{ marginTop: 20 }} onClick={() => { setCartOpen(false); setCart({}); setDeliveryOptionId(null); setCollectionNotes(''); setStage('browsing'); }}>
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
