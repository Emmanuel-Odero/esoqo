# Shaping the Esoko estore around Kenya's & Africa's MSMEs

**Type** · Research + product direction (design doc; implementation lands in `apps/store`)
**Prepared** · 11 August 2026
**Status** · Direction agreed — P1 & P2 scoped below

This document records the validated pain points of Kenyan/African micro & small businesses
(MSMEs), the needs they imply, and the concrete changes they drive on the Esoko estore. It
starts from research, then maps every change to the codebase seams where it lands.

---

## 1 · Who the estore serves, and why this matters

Kenya's informal economy (jua kali artisans, market vendors, boda operators, table-banking
chamas) employs the majority of working Kenyans — jua kali alone is >80% of employment.
Mobile is the viable commerce rail: 66M+ phone connections and 58.3% smartphone penetration
(Momanyi, IJRVET — Nairobi jua kali study). This is exactly the population Esoko's verified
Party + Enterprise + Store model already targets.

The estore therefore must not copy a Western marketplace playbook (inventory-heavy,
commission-capture, cashless-first). It must meet sellers *where they already trade*: on
WhatsApp, on cash, on a phone with patchy signal.

## 2 · Validated pain points (sources)

| # | Pain point | What the evidence says | Source |
|---|---|---|---|
| 1 | **Trust** | Buyers distrust anonymous sellers; marketplace anonymity is a stated e-commerce adoption barrier | CAK E-Commerce Draft Policy; GSMA *E-commerce in Africa* |
| 2 | **Discovery / visibility** | Marketplaces charge commission and dilute seller visibility; social commerce is where micro-MSMEs actually win orders but stays manual | GSMA *E-commerce in Africa* |
| 3 | **Payments & cash flow** | Cash-on-delivery preference and manual social payments wreck MSME cash flow; mobile-money rails are the norm buyers and sellers share | GSMA; Esoko already M-Pesa-native |
| 4 | **Delivery / last mile** | The single biggest operational gap: informal, unrecorded, guessed pricing, no tracking, no proof | CAK; Esoko shipping-partner proposal "today" column |
| 5 | **Working capital** | Inventory-heavy formalisation failed: Twiga (3rd layoffs, killed Series D), Copia (left Uganda), Sendy — ~$150M burned 2020–21 | ImpactAlpha, *Trouble at Twiga* (Aug 2023) |
| 6 | **Digital skills & connectivity** | Low digital literacy, uneven infrastructure, low app adoption | CAK; GSMA; IJRVET |
| 7 | **Fragmented regulation** | Multiple/unclear rules raise compliance cost disproportionately for micro firms | CAK E-Commerce Draft Policy |

### What this validates we should NOT do
- Do **not** hold inventory or prepay stock on the platform's balance sheet (Twiga trap).
- Do **not** make checkout cashless-only (kill the cash buyer).
- Do **not** require an app or high-end smartphone (USSD/SMS/WhatsApp fallback).

## 3 · Needs → estore changes

### P1 · Quick wins (independent, shippable now)

**A. Share-to-sell (social commerce alignment)**
Sellers already move goods over WhatsApp. The storefront product card gains a **Share via
WhatsApp** action producing a prefilled message + deep link, so a store can be shared into
the personal networks where micro-MSMES trade — with zero new habit to teach.
Landing: `StorefrontClient.tsx` product cards + a trusted deep link `?p=<productId>` that
re-opens that product's variant picker on load.

**B. M-Pesa STK + cash-on-delivery at checkout**
Checkout currently hardcodes `MPESA_STK`. `StoreOrderPaymentMethod` already has
`CASH_ON_DELIVERY` in the schema but nothing sets it.
- `checkoutSchema` gains `paymentMethod` and the server action stops hardcoding it.
- COD orders skip the STK push, start `PENDING_PAYMENT`, and the merchant confirms payment
  ("Mark paid") on the dashboard when cash is collected.
- A per-store `Store.codEnabled` switch lets the seller choose whether COD is offered.
- The STK **waiting screen gains polling** (the `checkOrderStatus` action exists but was
  never wired on the storefront — buy the real push UX now rather than the console auto-confirm).
Landing: `packages/domain/src/store.ts`, `apps/store/src/app/s/[slug]/actions.ts`,
`packages/db/src/dal/store-order.ts`, merchant orders page.

**C. Trust signals**
The platform's trust primitive `Attestation` attaches to Parties; `Enterprise.isRegistered`
and `Store.legalName`/`registrationNumber` (KRA PIN) are collected but never surfaced.
- "Verified Esoko business" badge when the owning `Enterprise.isRegistered` is true.
- Business identity block (legal name, registration no.) + county on the storefront story section.
Landing: `storefront-render.tsx` (pass enterprise), `StorefrontClient.tsx`.

**D. Cross-store discovery**
`/discover` lists active stores (newest-first, cap 60) with free-text search + county only;
`Store.primaryCategory` exists but never powers the directory.
- Category chips built from `Store.primaryCategory` (known keys from `PRODUCT_CATEGORIES`,
  free-text values grouped under "Other").
- Surface `primaryCategory` + verified state alongside search/county.
Landing: `apps/web/src/app/discover/*`, `packages/db/src/dal/store.ts` (`listPublicStores`).

### P2 · Structural (builds on P1)

**E. Order-first fulfilment (no held stock)**
- `Product.availableOnOrder` (+ variant) flag: seller sells "made/fulfilled when ordered"
  with no stock to hold and no platform balance-sheet risk.
- Such products stay buyable at `stockQty 0`/null and get a "Fulfilled when ordered" badge.
- Merchant product form gains the toggle.
Landing: Prisma `Product`/`ProductVariant`, product edit form, storefront rendering,
`createStoreOrder` stock logic.

**F. Delivery address + transparent pricing at checkout**
- Checkout captures a delivery address (street/estate/landmark) when a DELIVERY option is
  chosen; `StoreOrder.deliveryAddress` stores it.
- Existing flat `FulfilmentOption.feeKes` continues to show the price at selection
  (transparent already). Per-zone rate tables are a named follow-up (deep-links to the
  shipping-partner proposal's zone-rate model).
Landing: `checkoutSchema`, `StoreOrder`, `StorefrontClient` form stage.

**G. WhatsApp order capture**
- Per-product "Order via WhatsApp" deep link prefilled with product, qty, price and the
  store's contact — buyer orders in the channel they already use; seller clarifies/confirms
  manually. The validated "manual social commerce" weakness, but productised instead of
  fought.
Landing: `StorefrontClient.tsx` product cards + variants.
- **USSD order capture is documented as a follow-up** (needs a code + aggregator decision);
  not built in this pass.

## 4 · Non-goals this pass
- USSD code/aggregator integration (requires a shortcode decision).
- Real Daraja `production` provider (already explicitly unimplemented; `console`/`sandbox`
  unchanged). The checkout `paymentMethod` plumbing is provider-agnostic.
- Per-zone rate tables, carrier/tracking fields, refunds, cancellations — paved groundwork
  in this pass, shipped as next phases.

## 5 · Codebase map (where everything lands)

| Change | Seam |
|---|---|
| Schema fields (Store.codEnabled, Product.availableOnOrder, variant flag, StoreOrder.deliveryAddress) | `packages/db/prisma/schema.prisma` + one migration |
| Checkout schema (paymentMethod, deliveryAddress) | `packages/domain/src/store.ts` |
| Product update schema (availableOnOrder) | `packages/domain/src/store.ts` |
| COD order path + COD confirm + stock/order-first + enterprise include | `packages/db/src/dal/store-order.ts`, `dal/store.ts` |
| Discover listing (primaryCategory) | `packages/db/src/dal/store.ts`, `apps/web/src/app/discover/*` |
| Storefront UI (share, COD, address, polling, trust, order-first badges) | `apps/store/src/app/s/[slug]/StorefrontClient.tsx`, `storefront-render.tsx` |
| Merchant UI (mark paid, COD toggle, availableOnOrder toggle) | `apps/store/src/app/dashboard/*` |