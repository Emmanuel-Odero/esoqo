'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Icon, type IconName } from '@esoqo/ui';
import { PRODUCT_CATEGORIES } from '@esoqo/domain';
import { checkout, checkOrderStatus, myOrgMemberships } from './actions';

interface Variant { id: string; label: string; priceKes: number; stockQty: number | null; availableOnOrder: boolean }
interface Product {
  id: string; name: string; category: string | null; priceKes: number; stockQty: number | null;
  availableOnOrder: boolean; imageUrl: string | null; variants: Variant[];
}
interface FulfilmentOption { id: string; kind: 'PICKUP' | 'DELIVERY'; label: string; feeKes: number }
interface Social { key: string; handle: string }
interface StoreInfo {
  slug: string; name: string; themeKey: string;
  tagline: string | null; aboutUs: string | null; brandAccent: string | null;
  contactPerson: string | null; contactEmail: string | null; contactPhone: string | null;
  physicalAddress: string | null;
  deliveryOrigin: string | null; deliveryZones: string[]; processingDays: number | null;
  currency: string; settlementPhone: string | null;
  codEnabled: boolean; verified: boolean; county: string | null;
  legalName: string | null; registrationNumber: string | null;
  logoUrl: string | null; photos: string[]; socials: Social[];
}

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
const SOCIAL_LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp', linkedin: 'LinkedIn' };
const SOCIAL_ICON: Record<string, IconName> = { instagram: 'star', facebook: 'handshake', tiktok: 'message', whatsapp: 'message', linkedin: 'user' };
const SOCIAL_HREF: Record<string, (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h.replace(/^@/, '')}`,
  facebook: (h) => `https://facebook.com/${h.replace(/^@/, '')}`,
  tiktok: (h) => `https://tiktok.com/@${h.replace(/^@/, '')}`,
  whatsapp: (h) => `https://wa.me/${h.replace(/\D/g, '')}`,
  linkedin: (h) => `https://linkedin.com/in/${h.replace(/^@/, '')}`,
};

/** WhatsApp deep link addressing the shop directly when it has a number,
 *  otherwise left as "pick a recipient". */
function wa(store: StoreInfo, message: string) {
  const phone = (store.contactPhone ?? store.settlementPhone ?? '').replace(/\D/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/** A cart line is keyed by product id, or `${productId}:${variantId}` when
 *  the product sells by variant — two different sizes of the same item
 *  are two different lines. */
interface CartLine { productId: string; variantId: string | null; quantity: number }

export function StorefrontClient({ store, products, fulfilmentOptions }: {
  store: StoreInfo; products: Product[]; fulfilmentOptions: FulfilmentOption[];
}) {
  const base = THEME_ACCENTS[store.themeKey] ?? THEME_ACCENTS.market!;
  const theme = store.brandAccent
    ? { accent: store.brandAccent, tint: base.tint }
    : base;
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
  const [paymentMethod, setPaymentMethod] = useState<'MPESA_STK' | 'CASH_ON_DELIVERY'>('MPESA_STK');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set only when the store has a formal warehouse relationship — see
  // Store.dispatchWarehouseOrgId. Display-only, shown on the order
  // confirmation; doesn't affect fulfilment logic itself.
  const [dispatchFrom, setDispatchFrom] = useState<string | null>(null);
  // Empty for an anonymous visitor or one with no org memberships — the
  // common case, and the checkout defaults to "buying for myself" either
  // way, so this never blocks or slows down a normal purchase.
  const [myOrgs, setMyOrgs] = useState<{ id: string; name: string }[]>([]);
  const [buyingOrgId, setBuyingOrgId] = useState<string>('');
  const [pending, startTransition] = useTransition();
  // The clickable share origin — populated only on the client, because
  // SSR has no window.location. Share buttons render once it's known, so
  // server-produced HTML never ships a bogus href. The friendly /@slug
  // address is what a seller pastes straight into a WhatsApp status.
  const [origin, setOrigin] = useState('');

  // A shared link can carry ?p=<productId> — land the recipient straight
  // on that product's option picker instead of a scroll-and-hunt.
  useEffect(() => {
    myOrgMemberships().then(setMyOrgs).catch(() => setMyOrgs([]));
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    const pId = new URLSearchParams(window.location.search).get('p');
    if (!pId) return;
    const target = products.find((x) => x.id === pId);
    if (target?.variants.length) setPickingVariantFor(target);
    document.getElementById(`p-${pId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [products]);

  // Poll the status of a placed M-Pesa order while the Daraja callback is
  // in flight (console auto-confirm never visits this — it returns PAID).
  useEffect(() => {
    if (stage !== 'waiting' || !placedOrderId) return;
    const t = setInterval(async () => {
      const res = await checkOrderStatus(placedOrderId).catch(() => null);
      if (res?.status === 'PAID' || res?.status === 'FULFILLED') {
        setDispatchFrom(res.dispatchFrom);
        setStage('success');
      }
    }, 4000);
    return () => clearInterval(t);
  }, [stage, placedOrderId]);

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
        deliveryAddress,
        paymentMethod,
        buyingOrgId: buyingOrgId || undefined,
      });
      if (!result.ok) { setError(result.error); setStage('error'); return; }
      setPlacedOrderId(result.data.orderId);
      setDispatchFrom(result.data.dispatchFrom);
      // COD is confirmed by the merchant when the cash lands — the buyer's
      // screen is "order placed", not a payment prompt.
      setStage(result.data.status === 'PAID' || paymentMethod === 'CASH_ON_DELIVERY' ? 'success' : 'waiting');
    });
  }

  const hasStory = Boolean(store.aboutUs || store.photos.length > 0 || store.socials.length > 0 || store.physicalAddress || store.contactEmail || store.contactPerson);
  const coverPhoto = store.photos[0] ?? null;
  const hasContact = Boolean(store.contactPerson || store.contactEmail || store.contactPhone || store.physicalAddress);
  // Small shops don't need search or category filters — hide them to keep
  // the catalog compact and save vertical space.
  const showCatalogTools = products.length > 6;

  return (
    <div className="sf" style={{ ['--sf-accent' as string]: theme.accent, ['--sf-accent-t' as string]: theme.tint }}>
      <header className="sf-hero">
        {coverPhoto && <img className="sf-cover" src={coverPhoto} alt="" aria-hidden="true" />}
        <div className="sf-glow" aria-hidden="true" />
        <div className="sf-wrap">
          <div className="sf-hero-top">
            <a className="sf-back" href={DISCOVER_URL}><Icon name="arrow-left" size={14} />All shops on Esoqo</a>
            <div className="sf-hero-actions">
              {origin && (
                <a
                  className="sf-cart-btn" href={wa(store, `Check out *${store.name}* on Esoqo — ${origin}/@${store.slug}`)}
                  target="_blank" rel="noopener noreferrer" aria-label="Share this shop on WhatsApp"
                >
                  <Icon name="send" size={19} />
                </a>
              )}
              <button type="button" className="sf-cart-btn" onClick={() => setCartOpen(true)} aria-label={`Basket, ${cartCount} items`}>
                <Icon name="basket" size={19} />
                {cartCount > 0 && <span className="n">{cartCount}</span>}
              </button>
            </div>
          </div>
          <div className="sf-hero-row">
            <div className="sf-ident">
              {store.logoUrl ? (
                <img className="sf-logo" src={store.logoUrl} alt={`${store.name} logo`} />
              ) : (
                <span className="sf-monogram" style={{ ['--sf-accent' as string]: theme.accent }}>{store.name.slice(0, 2).toUpperCase()}</span>
              )}
              <div className="sf-ident-txt">
                <p className="sf-kicker"><span className="sf-dot" style={{ background: theme.accent }} />Esoqo store</p>
                <h1>{store.name}</h1>
                <p className="addr mono">esoko.global/@{store.slug}</p>
                {store.tagline && <p className="sf-tagline">{store.tagline}</p>}
              </div>
            </div>
          </div>
          <div className="sf-trust">
            {store.verified && (
              <span className="sf-trust-chip sf-chip-verified"><Icon name="shield-check" size={13} />Verified Esoqo business</span>
            )}
            <span className="sf-trust-chip"><Icon name="phone-call" size={13} />Pay with M-Pesa{store.codEnabled ? ' or cash on delivery' : ''}</span>
            {fulfilmentOptions.length > 0 && (
              <span className="sf-trust-chip">
                <Icon name={fulfilmentOptions.some((f) => f.kind === 'DELIVERY') ? 'truck' : 'shop'} size={13} />
                {fulfilmentOptions.some((f) => f.kind === 'DELIVERY') ? 'Delivery available' : 'Pickup available'}
              </span>
            )}
            {products.length > 0 && (
              <span className="sf-trust-chip"><Icon name="box" size={13} />{products.length} item{products.length !== 1 ? 's' : ''}</span>
            )}
            {store.contactPhone && <span className="sf-trust-chip"><Icon name="phone" size={13} />{store.contactPhone}</span>}
            {store.physicalAddress && <span className="sf-trust-chip"><Icon name="pin" size={13} />{store.physicalAddress}</span>}
            {store.deliveryOrigin && <span className="sf-trust-chip"><Icon name="bank" size={13} />{store.deliveryOrigin}</span>}
            {store.county && <span className="sf-trust-chip"><Icon name="map" size={13} />{store.county}</span>}
          </div>
        </div>
      </header>

      <div className="sf-bar">
        <div className="sf-wrap sf-bar-in">
          <a className="sf-bar-id" href="#catalog" aria-label={`${store.name}, back to catalog`}>
            {store.logoUrl ? (
              <img className="sf-bar-logo" src={store.logoUrl} alt="" />
            ) : (
              <span className="sf-bar-logo sf-bar-mono" style={{ background: theme.accent }}>{store.name.slice(0, 2).toUpperCase()}</span>
            )}
            <b>{store.name}</b>
          </a>
          {showCatalogTools && (
            <div className="sf-search">
              <span className="mg"><Icon name="search" size={16} /></span>
              <input
                type="search" placeholder={`Search ${store.name}`}
                value={query} onChange={(e) => setQuery(e.target.value)}
                aria-label={`Search products in ${store.name}`}
              />
            </div>
          )}
          {showCatalogTools && categories.length > 1 && (
            <div className="sf-chips" role="group" aria-label="Filter by category">
              <button type="button" className="sf-chip" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
              {categories.map((c) => (
                <button type="button" key={c} className="sf-chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {CATEGORY_LABEL[c] ?? c}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="sf-cart-btn sf-cart-mini" onClick={() => setCartOpen(true)} aria-label={`Basket, ${cartCount} items`}>
            <Icon name="basket" size={18} />
            {cartCount > 0 && <span className="n">{cartCount}</span>}
          </button>
        </div>
      </div>

      <div className="sf-wrap" style={{ paddingBottom: 8 }}>
        {hasStory && (
          <section className="sf-about" aria-label={`About ${store.name}`}>
            <p className="sf-eyebrow">The story</p>
            <h2 className="sf-about-h">About {store.name}</h2>
            <div className="sf-about-grid">
              <div className="sf-about-txt">
                {(store.verified || store.legalName || store.registrationNumber) && (
                  <div className="sf-ident-badge">
                    {store.verified && <span className="sf-ident-ok"><Icon name="shield-check" size={13} />Verified Esoqo business</span>}
                    {store.legalName && <span><Icon name="building" size={13} />{store.legalName}</span>}
                    {store.registrationNumber && <span className="mono"><Icon name="seal" size={13} />Reg. {store.registrationNumber}</span>}
                  </div>
                )}
                {store.aboutUs && <p>{store.aboutUs}</p>}
                {hasContact && (
                  <div className="sf-contact">
                    {store.contactPerson && <span><Icon name="user" size={13} />{store.contactPerson}</span>}
                    {store.contactEmail && <a href={`mailto:${store.contactEmail}`}><Icon name="mail" size={13} />{store.contactEmail}</a>}
                    {store.contactPhone && <a href={`tel:${store.contactPhone.replace(/\s+/g, '')}`}><Icon name="phone" size={13} />{store.contactPhone}</a>}
                    {store.physicalAddress && <span><Icon name="pin" size={13} />{store.physicalAddress}</span>}
                  </div>
                )}
                {store.socials.length > 0 && (
                  <div className="sf-socials">
                    {store.socials.map((s) => (
                      <a key={s.key} className="sf-social" href={SOCIAL_HREF[s.key]?.(s.handle) ?? '#'} target="_blank" rel="noopener noreferrer">
                        <Icon name={SOCIAL_ICON[s.key] ?? 'handshake'} size={13} />{SOCIAL_LABEL[s.key] ?? s.key}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {store.photos.length > 0 && (
                <div className="sf-gallery" aria-label="Photos">
                  {store.photos.map((src) => (
                    <img key={src} src={src} alt={`${store.name} storefront`} loading="lazy" />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {products.length === 0 ? (
          <div className="sf-empty">
            <span className="icbox"><Icon name="box" size={22} /></span>
            <h3 style={{ marginBottom: 6 }}>Nothing listed yet</h3>
            <p style={{ color: 'var(--tx-2)', margin: 0 }}>{store.name} hasn&apos;t added products. Check back soon.</p>
          </div>
        ) : (
          <section className="sf-catalog" aria-label="Products">
            <div className="sf-cathead">
              <div>
                <p className="sf-eyebrow">Catalog</p>
                <h2>{category ? CATEGORY_LABEL[category] ?? category : 'Everything in this shop'}</h2>
              </div>
              <p className="sf-count">{visible.length} item{visible.length !== 1 ? 's' : ''}</p>
            </div>

            {grouped.map((group) => (
              <div key={group.label ?? 'all'} className="sf-sect">
                {group.label && <h3 className="sf-sect-h">{group.label}</h3>}
                <div className="sf-grid">
                  {group.items.map((p) => {
                    const qty = p.variants.length === 0 ? (cart[lineKey(p.id, null)]?.quantity ?? 0) : null;
                    // Order-first: the shop fulfils when you order, so a
                    // zero/null stock card stays buyable and carries the
                    // "Fulfilled when ordered" badge instead of "sold out".
                    const orderFirst = p.availableOnOrder || (p.variants.length > 0 && p.variants.every((v) => v.availableOnOrder));
                    const canSellZero = p.availableOnOrder || (p.variants.length > 0 && p.variants.some((v) => v.availableOnOrder));
                    const outOfStock = p.variants.length > 0
                      ? p.variants.every((v) => (v.stockQty !== null && v.stockQty <= 0) && !v.availableOnOrder)
                      : p.stockQty !== null && p.stockQty <= 0 && !p.availableOnOrder;
                    const minPrice = p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.priceKes)) : p.priceKes;
                    return (
                      <article className="sf-card" key={p.id} id={`p-${p.id}`}>
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
                            : orderFirst
                              ? <span className="sf-badge sf-badge-off">Fulfilled when ordered</span>
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
                          {(canSellZero || !outOfStock) && !p.variants.length && (
                            <div className="sf-card-actions">
                              <a className="sf-act" href={wa(store, `Hi ${store.name}! I'd like to order:\n• ${p.name} — ${kes(minPrice)}`)} target="_blank" rel="noopener noreferrer">
                                <Icon name="message" size={13} />Order via WhatsApp
                              </a>
                              {origin && (
                                <a className="sf-act" href={wa(store, `*${store.name}*\n${p.name} — ${kes(minPrice)}\n${origin}/@${store.slug}?p=${p.id}`)} target="_blank" rel="noopener noreferrer">
                                  <Icon name="send" size={13} />Share
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <footer className="sf-footer">
        <div className="sf-foot-glow" aria-hidden="true" />
        <div className="sf-wrap">
          <div className="sf-foot-grid">
            <div className="sf-foot-brand">
              {store.logoUrl ? (
                <img className="sf-foot-logo" src={store.logoUrl} alt={`${store.name} logo`} />
              ) : (
                <span className="sf-foot-logo sf-foot-mono" style={{ background: theme.accent }}>{store.name.slice(0, 2).toUpperCase()}</span>
              )}
              <div>
                <b>{store.name}</b>
                <span>esoko.global/@{store.slug}</span>
              </div>
            </div>
            {hasContact && (
              <div className="sf-foot-col">
                <h4>Contact</h4>
                {store.contactPhone && <a href={`tel:${store.contactPhone.replace(/\s+/g, '')}`}><Icon name="phone" size={13} />{store.contactPhone}</a>}
                {store.contactEmail && <a href={`mailto:${store.contactEmail}`}><Icon name="mail" size={13} />{store.contactEmail}</a>}
                {store.physicalAddress && <span className="sf-foot-line"><Icon name="pin" size={13} />{store.physicalAddress}</span>}
              </div>
            )}
            {store.socials.length > 0 && (
              <div className="sf-foot-col">
                <h4>Follow</h4>
                {store.socials.map((s) => (
                  <a key={s.key} href={SOCIAL_HREF[s.key]?.(s.handle) ?? '#'} target="_blank" rel="noopener noreferrer">
                    <Icon name={SOCIAL_ICON[s.key] ?? 'handshake'} size={13} />{SOCIAL_LABEL[s.key] ?? s.key}
                  </a>
                ))}
              </div>
            )}
            {store.deliveryZones.length > 0 && (
              <div className="sf-foot-col">
                <h4>We deliver to</h4>
                <div className="sf-foot-zones">
                  {store.deliveryZones.map((z) => <span key={z}>{z}</span>)}
                </div>
              </div>
            )}
          </div>
          <div className="sf-foot-bottom">
            <span>Payments via M-Pesa{store.codEnabled ? ' & cash on delivery' : ''}</span>
            <a className="sf-foot-discover" href={DISCOVER_URL}>Back to all shops on Esoqo</a>
          </div>
        </div>
      </footer>

      {pickingVariantFor && (
        <div role="dialog" aria-label={`Choose an option for ${pickingVariantFor.name}`} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(10,20,30,.45)' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(360px, 92vw)' }}>
            <h3 style={{ marginBottom: 4 }}>{pickingVariantFor.name}</h3>
            <p style={{ color: 'var(--tx-2)', fontSize: '.82rem', margin: '0 0 12px' }}>
              Prefer WhatsApp? <a className="sf-act-in" href={wa(store, `Hi ${store.name}! I'd like to order:\n• ${pickingVariantFor.name}`)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sf-accent)', fontWeight: 600 }}>Order via WhatsApp</a>
            </p>
            {pickingVariantFor.variants.map((v) => {
              const out = v.stockQty !== null && v.stockQty <= 0 && !v.availableOnOrder;
              return (
                <button
                  key={v.id} type="button" className="opt" disabled={out}
                  style={{ width: '100%', marginBottom: 8, opacity: out ? 0.5 : 1 }}
                  onClick={() => { setQty(pickingVariantFor.id, v.id, (cart[lineKey(pickingVariantFor.id, v.id)]?.quantity ?? 0) + 1); setPickingVariantFor(null); }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>{v.label}{out ? ' — out of stock' : v.availableOnOrder && (v.stockQty === null || v.stockQty <= 0) ? ' — fulfilled when ordered' : ''}</span>
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
                  Checkout <Icon name="arrow-right" size={16} />
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
                {deliveryOption?.kind === 'DELIVERY' && (
                  <div className="fld">
                    <label className="lab" htmlFor="baddr">Delivery address</label>
                    <input className="inp" id="baddr" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Estate, street, landmark — e.g. Juja, Thika Rd, near posta" />
                  </div>
                )}
                {store.codEnabled && (
                  <div className="fld">
                    <p className="lab">How will you pay?</p>
                    <div className="sf-payopts">
                      <button type="button" className="opt" aria-pressed={paymentMethod === 'MPESA_STK'} onClick={() => setPaymentMethod('MPESA_STK')}>
                        <span><Icon name="phone-call" size={13} /> Pay with M-Pesa</span>
                      </button>
                      <button type="button" className="opt" aria-pressed={paymentMethod === 'CASH_ON_DELIVERY'} onClick={() => setPaymentMethod('CASH_ON_DELIVERY')}>
                        <span><Icon name="check-circle" size={13} /> Cash on delivery</span>
                      </button>
                    </div>
                  </div>
                )}

                {myOrgs.length > 0 && (
                  <div className="fld">
                    <label className="lab" htmlFor="buyingFor">Buying for</label>
                    <select className="inp" id="buyingFor" value={buyingOrgId}
                      onChange={(e) => setBuyingOrgId(e.target.value)}>
                      <option value="">Myself</option>
                      {myOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="fld">
                  <label className="lab" htmlFor="bname">Your name</label>
                  <input className="inp" id="bname" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                </div>
                <div className="fld">
                  <label className="lab" htmlFor="bmsisdn">{paymentMethod === 'CASH_ON_DELIVERY' ? 'Mobile number' : 'M-Pesa number'}</label>
                  <input className="inp mono" id="bmsisdn" value={buyerMsisdn} onChange={(e) => setBuyerMsisdn(e.target.value)} inputMode="tel" />
                </div>
                <button type="button" className="btn btn-g" style={{ width: '100%' }} disabled={pending || !buyerName.trim() || !buyerMsisdn.trim() || (deliveryOption?.kind === 'DELIVERY' && !deliveryAddress.trim())} onClick={submitCheckout}>
                  {pending
                    ? 'Placing order…'
                    : paymentMethod === 'CASH_ON_DELIVERY'
                      ? `Place order — pay ${kes(total)} on delivery`
                      : `Pay ${kes(total)} with M-Pesa`}
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
                <div className="co-success">
                  <Icon name={paymentMethod === 'CASH_ON_DELIVERY' ? 'check-circle' : 'check'} size={30} />
                </div>
                {paymentMethod === 'CASH_ON_DELIVERY' ? (
                  <>
                    <h2 style={{ fontSize: '1rem' }}>Order placed</h2>
                    <p style={{ color: 'var(--tx-2)', fontSize: '.86rem', marginTop: 6 }}>
                      {`${store.name} has your order — ${kes(total)} to pay on delivery. They'll be in touch to confirm.`}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 style={{ fontSize: '1rem' }}>Payment received</h2>
                    <p style={{ color: 'var(--tx-2)', fontSize: '.86rem', marginTop: 6 }}>
                      {`${store.name} has been notified. You'll get an SMS when your order is ready.`}
                    </p>
                  </>
                )}
                {dispatchFrom && (
                  <p style={{ color: 'var(--tx-3)', fontSize: '.79rem', marginTop: 10 }}>
                    Dispatched from: {dispatchFrom}
                  </p>
                )}
                <button type="button" className="btn btn-o" style={{ marginTop: 20 }} onClick={() => { setCartOpen(false); setCart({}); setDeliveryOptionId(null); setCollectionNotes(''); setDeliveryAddress(''); setPaymentMethod('MPESA_STK'); setStage('browsing'); }}>
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
