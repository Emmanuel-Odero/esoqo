'use client';

import { useRef, useState, useTransition } from 'react';
import { Icon, type IconName, SelectWithOther } from '@esoko/ui';
import { PRODUCT_CATEGORIES } from '@esoko/domain';
import {
  saveProfileStep, uploadLogo, uploadFavicon, uploadStorePhoto, removeStorePhoto,
  type ProfileStep,
} from './actions';

interface IdentityState {
  legalName: string; registrationNumber: string; contactPerson: string;
  contactEmail: string; contactPhone: string; physicalAddress: string;
}
interface BrandingState {
  tagline: string; aboutUs: string; brandAccent: string;
  instagram: string; facebook: string; tiktok: string; whatsapp: string; linkedin: string;
}
interface CatalogState { primaryCategory: string; otherCategory: string; skuCount: string }
interface ShippingState { deliveryOrigin: string; deliveryZones: string[]; processingDays: string }
interface PaymentsState { currency: string; taxRatePct: string; settlementPhone: string; codEnabled: boolean }

export interface ProfileInitial {
  identity: IdentityState;
  branding: BrandingState;
  catalog: { primaryCategory: string; skuCount: number | null | undefined };
  shipping: { deliveryOrigin: string; deliveryZones: string[]; processingDays: number | null | undefined };
  payments: { currency: string; taxRatePct: number | null | undefined; settlementPhone: string; codEnabled: boolean };
  assets: { logoUrl: string | null; faviconUrl: string | null; photos: { id: string; url: string }[] };
}

const STEPS: { key: ProfileStep; icon: IconName; title: string }[] = [
  { key: 'identity', icon: 'building', title: 'Business identity' },
  { key: 'branding', icon: 'star', title: 'Branding & photos' },
  { key: 'catalog', icon: 'box', title: 'What you sell' },
  { key: 'shipping', icon: 'truck', title: 'Shipping & fulfilment' },
  { key: 'payments', icon: 'bank', title: 'Payments' },
];

const ACCENT_SWATCHES = ['#12794A', '#0F5C9E', '#B8760B', '#7B2FBE', '#C0392B', '#0A2E4D'];

function SocialFields({ values, set }: { values: BrandingState; set: (patch: Partial<BrandingState>) => void }) {
  const fields: [keyof BrandingState, string, string][] = [
    ['instagram', 'Instagram', '@username'],
    ['facebook', 'Facebook', 'page name or URL'],
    ['tiktok', 'TikTok', '@username'],
    ['whatsapp', 'WhatsApp', '+254 7•• ••• •••'],
    ['linkedin', 'LinkedIn', 'URL'],
  ];
  return (
    <>
      {fields.map(([key, label, ph]) => (
        <div className="fld" key={key}>
          <label className="lab" htmlFor={`bd-${key}`}>{label}</label>
          <input className="inp" id={`bd-${key}`} value={values[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} placeholder={ph} />
        </div>
      ))}
    </>
  );
}

function AssetUpload({ label, url, onUpload, pending }: {
  label: string; url: string | null; onUpload: (form: FormData) => void; pending: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="asset-row">
      <div className="asset-thumb">
        {url ? <img src={url} alt={label || ''} /> : <Icon name="star" size={20} />}
      </div>      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="lab" style={{ marginBottom: 4 }}>{label}</p>
        <button type="button" className="btn btn-o btn-sm" onClick={() => ref.current?.click()} disabled={pending}>
          {pending ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        </button>
        <input
          ref={ref} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.append('file', f);
            onUpload(fd);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

export function StoreProfileEditor({ storeId, initial }: { storeId: string; initial: ProfileInitial }) {
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingAsset, setPendingAsset] = useState(false);

  const [identity, setIdentity] = useState<IdentityState>(initial.identity);
  const [branding, setBranding] = useState<BrandingState>(initial.branding);
  const [catalog, setCatalog] = useState<CatalogState>(() => {
    const stored = initial.catalog.primaryCategory ?? '';
    const isKnown = PRODUCT_CATEGORIES.some(([k]) => k === stored);
    return {
      primaryCategory: isKnown || !stored ? stored : 'OTHER',
      otherCategory: isKnown || !stored ? '' : stored,
      skuCount: initial.catalog.skuCount == null ? '' : String(initial.catalog.skuCount),
    };
  });
  const [shipping, setShipping] = useState<ShippingState>({ ...initial.shipping, deliveryZones: initial.shipping.deliveryZones ?? [], processingDays: initial.shipping.processingDays == null ? '' : String(initial.shipping.processingDays) });
  const [payments, setPayments] = useState<PaymentsState>({ ...initial.payments, taxRatePct: initial.payments.taxRatePct == null ? '' : String(initial.payments.taxRatePct) });
  const [assets, setAssets] = useState(initial.assets);

  const current = STEPS[step]!;

  function stepPayload(): unknown {
    switch (current.key) {
      case 'identity': return identity;
      case 'branding': return branding;
      case 'catalog': return {
        primaryCategory: catalog.primaryCategory === 'OTHER'
          ? catalog.otherCategory.trim() || 'OTHER'
          : catalog.primaryCategory,
        skuCount: catalog.skuCount ? Number(catalog.skuCount) : null,
      };
      case 'shipping': return {
        deliveryOrigin: shipping.deliveryOrigin, deliveryZones: shipping.deliveryZones,
        processingDays: shipping.processingDays ? Number(shipping.processingDays) : null,
      };
      case 'payments': return {
        currency: payments.currency, taxRatePct: payments.taxRatePct ? Number(payments.taxRatePct) : null,
        settlementPhone: payments.settlementPhone, codEnabled: payments.codEnabled,
      };
    }
  }

  function save(advance: boolean) {
    setError(null); setSaved(false);
    startTransition(async () => {
      const result = await saveProfileStep(storeId, current.key, stepPayload());
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      if (advance) setStep((s) => Math.min(STEPS.length - 1, s + 1));
    });
  }

  function upload(which: 'logo' | 'favicon' | 'photo', fd: FormData) {
    setPendingAsset(true); setError(null);
    startTransition(async () => {
      const fn = which === 'logo' ? uploadLogo : which === 'favicon' ? uploadFavicon : uploadStorePhoto;
      const result = await fn(storeId, fd);
      if (!result.ok) { setError(result.error); setPendingAsset(false); return; }
      const url = result.url;
      if (url) {
        if (which === 'logo') setAssets((a) => ({ ...a, logoUrl: url }));
        else if (which === 'favicon') setAssets((a) => ({ ...a, faviconUrl: url }));
        else if (result.photoId) setAssets((a) => ({ ...a, photos: [...a.photos, { id: result.photoId as string, url }] }));
      }
      setPendingAsset(false);
    });
  }

  return (
    <div className="profile-card">
      <div className="wiz-steps">
        {STEPS.map((s, i) => <span key={s.key} title={s.title} className={i < step ? 'done' : i <= step ? 'on' : ''} />)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span className="icbox icbox-sm"><Icon name={current.icon} size={18} /></span>
        <p className="mono" style={{ fontSize: '.68rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', margin: 0 }}>
          Step {step + 1} of {STEPS.length} — {current.title}
        </p>
      </div>

      {error && <p className="err" role="alert" style={{ margin: '8px 0' }}><Icon name="alert-circle" size={14} />{error}</p>}
      {saved && <p style={{ color: 'var(--green)', fontSize: '.85rem', fontWeight: 600, margin: '8px 0' }}><Icon name="check" size={14} /> Saved</p>}

      {/* ── step 1: identity ─────────────────────────────────── */}
      {current.key === 'identity' && (
        <div className="field-group">
          <p className="hint" style={{ margin: '0 0 18px' }}>The formal name of your business and the details customers can use to reach you. Nothing here is required to sell.</p>
          <div className="fld">
            <label className="lab" htmlFor="p-legal">Legal / registered name <em className="dim">optional</em></label>
            <input className="inp" id="p-legal" value={identity.legalName} onChange={(e) => setIdentity({ ...identity, legalName: e.target.value })} placeholder="Kanini Fresh Produce Ltd" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p-reg">Business registration number <em className="dim">optional</em></label>
            <input className="inp mono" id="p-reg" value={identity.registrationNumber} onChange={(e) => setIdentity({ ...identity, registrationNumber: e.target.value })} placeholder="KRA PIN" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p-person">Contact person <em className="dim">optional</em></label>
            <input className="inp" id="p-person" value={identity.contactPerson} onChange={(e) => setIdentity({ ...identity, contactPerson: e.target.value })} placeholder="Mama Njeri" />
          </div>
          <div className="grid2">
            <div className="fld">
              <label className="lab" htmlFor="p-email">Email <em className="dim">optional</em></label>
              <input className="inp" id="p-email" value={identity.contactEmail} onChange={(e) => setIdentity({ ...identity, contactEmail: e.target.value })} placeholder="hello@kanini.co.ke" inputMode="email" />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="p-phone">Phone <em className="dim">optional</em></label>
              <input className="inp mono" id="p-phone" value={identity.contactPhone} onChange={(e) => setIdentity({ ...identity, contactPhone: e.target.value })} placeholder="+254 712 345 678" inputMode="tel" />
            </div>
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p-addr">Physical address <em className="dim">optional</em></label>
            <input className="inp" id="p-addr" value={identity.physicalAddress} onChange={(e) => setIdentity({ ...identity, physicalAddress: e.target.value })} placeholder="Kawangware, Ngong Road, Nairobi" />
          </div>
        </div>
      )}

      {/* ── step 2: branding & assets ───────────────────────── */}
      {current.key === 'branding' && (
        <div className="field-group">
          <div className="fld">
            <label className="lab" htmlFor="p-tagline">Tagline</label>
            <input className="inp" id="p-tagline" value={branding.tagline} onChange={(e) => setBranding({ ...branding, tagline: e.target.value })} placeholder="Fresh from the farm, every morning" maxLength={120} />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p-about">About this store</label>
            <textarea className="inp ta" id="p-about" value={branding.aboutUs} onChange={(e) => setBranding({ ...branding, aboutUs: e.target.value })} placeholder="Where the goods come from, how the shop started, what customers should know…" rows={5} maxLength={1500} />
          </div>

          <p className="lab">Brand colour</p>
          <div className="theme-grid" style={{ marginBottom: 18 }}>
            {ACCENT_SWATCHES.map((c) => (
              <button type="button" key={c} className="theme-opt" aria-pressed={branding.brandAccent.toLowerCase() === c} onClick={() => setBranding({ ...branding, brandAccent: c })}>
                <div className="theme-swatch"><i style={{ background: c }} /></div>
                <span style={{ fontSize: '.72rem', fontWeight: 600 }}>{c}</span>
              </button>
            ))}
            <button type="button" className="theme-opt" aria-pressed={!branding.brandAccent} onClick={() => setBranding({ ...branding, brandAccent: '' })}>
              <div className="theme-swatch"><i style={{ background: 'var(--line)' }} /></div>
              <span style={{ fontSize: '.72rem', fontWeight: 600 }}>Theme default</span>
            </button>
          </div>

          <p className="lab">Storefront logo</p>
          <AssetUpload label="" url={assets.logoUrl} onUpload={(fd) => upload('logo', fd)} pending={pendingAsset} />
          <p className="lab" style={{ marginTop: 18 }}>Favicon (browser tab icon)</p>
          <AssetUpload label="" url={assets.faviconUrl} onUpload={(fd) => upload('favicon', fd)} pending={pendingAsset} />

          <p className="lab" style={{ marginTop: 18 }}>Social links</p>
          <div className="grid2">
            <SocialFields values={branding} set={(patch) => setBranding({ ...branding, ...patch })} />
          </div>
        </div>
      )}

      {/* ── step 3: what you sell ───────────────────────────── */}
      {current.key === 'catalog' && (
        <div className="field-group">
          <SelectWithOther
            id="p-cat" label="What does your store mostly sell?"
            options={[['', 'Not sure yet'], ...PRODUCT_CATEGORIES]}
            value={catalog.primaryCategory} onChange={(v) => setCatalog({ ...catalog, primaryCategory: v })}
            customValue={catalog.otherCategory} onCustomChange={(v) => setCatalog({ ...catalog, otherCategory: v })}
            customLabel="What exactly? (optional)" customPlaceholder="e.g. Poultry, dairy & eggs"
            inputProps={{ maxLength: 60 }}
          />
          <div className="fld">
            <label className="lab" htmlFor="p-sku">Roughly how many things does the store carry?</label>
            <input className="inp mono" id="p-sku" value={catalog.skuCount} onChange={(e) => setCatalog({ ...catalog, skuCount: e.target.value })} placeholder="e.g. 120" inputMode="numeric" />
            <p className="hint">A rough count helps us size your dashboard. You can change it any time.</p>
          </div>
        </div>
      )}

      {/* ── step 4: shipping & fulfilment ───────────────────── */}
      {current.key === 'shipping' && (
        <div className="field-group">
          <div className="fld">
            <label className="lab" htmlFor="p-origin">Where are orders packed / picked up from?</label>
            <input className="inp" id="p-origin" value={shipping.deliveryOrigin} onChange={(e) => setShipping({ ...shipping, deliveryOrigin: e.target.value })} placeholder="Juja Main, Kiambu" />
          </div>
          <div className="fld">
            <p className="lab">Delivery areas</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {shipping.deliveryZones.map((z) => (
                <span key={z} className="chip">
                  {z}
                  <button type="button" aria-label={`Remove ${z}`} onClick={() => setShipping({ ...shipping, deliveryZones: shipping.deliveryZones.filter((x) => x !== z) })}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
            {shipping.deliveryZones.length < 20 && (
              <ZoneAdder zones={shipping.deliveryZones} onAdd={(z) => setShipping({ ...shipping, deliveryZones: [...shipping.deliveryZones, z] })} />
            )}
            <p className="hint">Areas you deliver to — Juja, Thika, Ruiru…<br />Priced delivery options live below on this page.</p>
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p-days">Typical turnaround (days)</label>
            <input className="inp mono" id="p-days" value={shipping.processingDays} onChange={(e) => setShipping({ ...shipping, processingDays: e.target.value })} placeholder="e.g. 1" inputMode="numeric" />
          </div>
        </div>
      )}

      {/* ── step 5: payments ────────────────────────────────── */}
      {current.key === 'payments' && (
        <div className="field-group">
          <div className="fld">
            <label className="lab" htmlFor="p-currency">Currency</label>
            <input className="inp mono" id="p-currency" value={payments.currency} onChange={(e) => setPayments({ ...payments, currency: e.target.value.toUpperCase() })} maxLength={3} placeholder="KES" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p-tax">VAT rate (%) — shown on the storefront when set</label>
            <input className="inp mono" id="p-tax" value={payments.taxRatePct} onChange={(e) => setPayments({ ...payments, taxRatePct: e.target.value })} placeholder="e.g. 16" inputMode="numeric" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p-settle">M-Pesa number for settlements</label>
            <input className="inp mono" id="p-settle" value={payments.settlementPhone} onChange={(e) => setPayments({ ...payments, settlementPhone: e.target.value })} placeholder="+254 712 345 678" inputMode="tel" />
            <p className="hint">Payouts run through the business account on file today — this is the storefront-facing number.</p>
          </div>
          <button
            type="button"
            className="opt"
            aria-pressed={payments.codEnabled}
            onClick={() => setPayments({ ...payments, codEnabled: !payments.codEnabled })}
            style={{ width: '100%' }}
          >
            <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: 12 }}>
              <span>
                <b className="t" style={{ fontSize: '.92rem' }}>Cash on delivery</b>
                <span className="d">Let shoppers order now and pay cash when the order lands — popular with buyers who don&apos;t pay by phone.</span>
              </span>
              <span className="mono" style={{ fontWeight: 700, flex: 'none' }}>{payments.codEnabled ? 'On' : 'Off'}</span>
            </span>
          </button>
        </div>
      )}

      <div className="wiz-nav">
        <button type="button" className="btn btn-o" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending}>
          Back
        </button>
        <div>
          <button type="button" className="btn btn-o" style={{ marginRight: 8 }} onClick={() => save(false)} disabled={pendingAsset || pending}>
            {pending && !pendingAsset ? 'Saving…' : 'Save'}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-p" onClick={() => save(true)} disabled={pendingAsset || pending}>
              Save &amp; continue <Icon name="arrow-right" size={16} />
            </button>
          ) : (
            <button type="button" className="btn btn-g" onClick={() => save(false)} disabled={pendingAsset || pending}>
              {pending ? 'Saving…' : 'Done'} <Icon name="check" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── photo gallery, on the branding step ─────────────── */}
      {current.key === 'branding' && (
        <div className="field-group" style={{ marginTop: 24, borderBottom: 0 }}>
          <h3>Storefront photos</h3>
          <p className="hint" style={{ margin: '0 0 14px' }}>Your shopfront, products, the team — images that make the store real. Shown as a gallery near the top of your storefront.</p>
          <div className="photo-grid">
            <button
              type="button" className="photo-add" onClick={() => document.getElementById('store-photo-input')?.click()}
              disabled={pendingAsset}
              aria-label="Add a photo"
            >
              <Icon name="plus" size={22} />
              <span className="dim">Add photo</span>
            </button>
            <input id="store-photo-input" type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append('file', f);
              upload('photo', fd);
              e.target.value = '';
            }} />
            {assets.photos.map((ph) => (
              <div className="photo" key={ph.id}>
                <img src={ph.url} alt="" loading="lazy" />
                <button
                  type="button" className="photo-x" aria-label="Remove photo"
                  onClick={() => {
                    setPendingAsset(true); setError(null);
                    startTransition(async () => {
                      const r = await removeStorePhoto(ph.id);
                      if (!r.ok) setError(r.error);
                      else setAssets((a) => ({ ...a, photos: a.photos.filter((p) => p.id !== ph.id) }));
                      setPendingAsset(false);
                    });
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneAdder({ zones, onAdd }: { zones: string[]; onAdd: (zone: string) => void }) {
  const [value, setValue] = useState('');
  const [added, setAdded] = useState(false);
  function submit() {
    const z = value.trim();
    if (!z || zones.includes(z) || zones.length >= 20) return;
    onAdd(z); setValue(''); setAdded(true);
    setTimeout(() => setAdded(false), 1200);
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        className="inp" value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder="Add an area then press Enter" aria-label="Delivery area"
      />
      <button type="button" className="btn btn-o" onClick={submit} disabled={!value.trim()}>Add</button>
      {added && <span className="dim" role="status">Added</span>}
    </div>
  );
}