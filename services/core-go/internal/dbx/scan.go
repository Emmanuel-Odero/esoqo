package dbx

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/esoqo/core-go/internal/money"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/fleetqr"
)

// Scan kinds — one dispatcher for every physical code in the Esoqo
// world: bus boarding QRs, product barcodes (mall self-checkout), table
// QRs (restaurant order-from-table), vouchers, fare receipts, event
// tickets, store pickup codes, payment ids and printed certificate
// codes. Clients call GET /v1/scan/resolve and route by Kind; every
// projection below is public-safe (no msisdn, no PII beyond what a
// credential or payment card is meant to show anywhere).
const (
	ScanKindTrip        = "trip"
	ScanKindVoucher     = "voucher"
	ScanKindFare        = "fare"
	ScanKindProduct     = "product"
	ScanKindStore       = "store"
	ScanKindTable       = "table"
	ScanKindTicket      = "ticket"
	ScanKindOrder       = "order"
	ScanKindParty       = "party"
	ScanKindCertificate = "certificate"
	ScanKindParcel      = "parcel"
	ScanKindLuggage     = "luggage"
	ScanKindUnknown     = "unknown"
)

// Scan actions — the resolve answer tells a client what to DO next
// (not just what was scanned), so even a guest renders the expected
// info — menu, pay, verify, pickup — without duplicating dispatch
// logic: any code that is public to hold should be public to act on.
const (
	ActionPay      = "pay"
	ActionMenu     = "menu"
	ActionCheckout = "checkout"
	ActionPickup   = "pickup"
	ActionVerify   = "verify"
	ActionOpen     = "open"
	ActionInfo     = "info"
	ActionTrack    = "track"
)

func actionForKind(kind string) string {
	switch kind {
	case ScanKindTrip:
		return ActionPay
	case ScanKindVoucher:
		return ActionInfo
	case ScanKindFare:
		return ActionVerify
	case ScanKindProduct:
		return ActionCheckout
	case ScanKindStore:
		return ActionOpen
	case ScanKindTable:
		return ActionMenu
	case ScanKindTicket:
		return ActionVerify
	case ScanKindOrder:
		return ActionPickup
	case ScanKindParty:
		return ActionPay
	case ScanKindCertificate:
		return ActionVerify
	case ScanKindParcel:
		return ActionTrack
	case ScanKindLuggage:
		// Track, not verify: whoever scans a luggage stub is asking
		// "where is my bag", and the projection behind it is the
		// guest-safe one. Crew who need to act on it are in the luggage
		// desk, which is capability-gated and does not come through here.
		return ActionTrack
	default:
		return ActionInfo
	}
}

// ScanHit is the dispatcher answer. Only the matching member is set.
type ScanHit struct {
	Kind        string
	Action      string
	Trip        *TripResolve
	Voucher     *VoucherPublic
	Fare        *PublicFareProof
	Product     *ProductHit
	Store       *StoreHit
	Table       *TableHit
	Ticket      *TicketHit
	Order       *OrderHit
	Party       *PartyHit
	Certificate *CertificateHit
	Parcel      *ParcelStatusView
	Luggage     *LuggageScanInfo
}

func unknownHit() *ScanHit {
	return &ScanHit{Kind: ScanKindUnknown, Action: actionForKind(ScanKindUnknown)}
}

func hit[T any](kind string, payload T) *ScanHit {
	h := &ScanHit{Kind: kind, Action: actionForKind(kind)}
	switch kind {
	case ScanKindTrip:
		h.Trip = any(payload).(*TripResolve)
	case ScanKindVoucher:
		h.Voucher = any(payload).(*VoucherPublic)
	case ScanKindFare:
		h.Fare = any(payload).(*PublicFareProof)
	case ScanKindProduct:
		h.Product = any(payload).(*ProductHit)
	case ScanKindStore:
		h.Store = any(payload).(*StoreHit)
	case ScanKindTable:
		h.Table = any(payload).(*TableHit)
	case ScanKindTicket:
		h.Ticket = any(payload).(*TicketHit)
	case ScanKindOrder:
		h.Order = any(payload).(*OrderHit)
	case ScanKindParty:
		h.Party = any(payload).(*PartyHit)
	case ScanKindCertificate:
		h.Certificate = any(payload).(*CertificateHit)
	case ScanKindParcel:
		h.Parcel = any(payload).(*ParcelStatusView)
	case ScanKindLuggage:
		h.Luggage = any(payload).(*LuggageScanInfo)
	}
	return h
}

// shortCodePrefixes is the registered-prefix namespace table: every
// human-typable short code starts with one of these, so the dispatcher
// routes by prefix (never by sniff ordering) and a BUS- code can never
// resolve as a voucher. Registry lives beside fleetqr.Prefix — this
// map is the scan-side view of the same namespaces.
var shortCodePrefixes = []struct {
	prefix string
	kind   string
	// checkedLen is the random-segment length when the new minted shape
	// carries a trailing checksum char (see fleetqr.WithCheck). Codes of
	// this exact length that fail the checksum are typos, not retired
	// real codes — reject them without a DB round-trip. Old unchecked
	// codes (one char shorter) stay resolvable.
	checkedLen int
}{
	{prefix: "BUS-", kind: ScanKindTrip, checkedLen: 6},
	{prefix: "TRIP-", kind: ScanKindTrip, checkedLen: 6},
	{prefix: "VCH-", kind: ScanKindVoucher, checkedLen: 6},
	{prefix: "TKT-", kind: ScanKindTicket},
	{prefix: "PKP-", kind: ScanKindOrder},
	{prefix: "ESK-", kind: ScanKindParty},
	{prefix: "PKG-", kind: ScanKindParcel, checkedLen: 6},
	// Checked, like BUS-/TRIP-/VCH-/PKG-: a LUG- code is read aloud off
	// a paper stub and typed by hand more than any other code here, so
	// rejecting a fat-fingered character without a round trip is worth
	// more on this prefix than on any of them.
	{prefix: "LUG-", kind: ScanKindLuggage, checkedLen: 6},
}

// VoucherPublic is the card anyone holding the QR may see.
type VoucherPublic struct {
	ShortCode     string       `json:"shortCode"`
	Label         string       `json:"label"`
	Purpose       string       `json:"purpose"`
	Status        string       `json:"status"`
	BalancePoints int          `json:"balancePoints"`
	BalanceKES    money.Amount `json:"balanceKes"`
}

// ProductHit resolves a scanned SKU/EAN to a buyable product.
type ProductHit struct {
	ProductID string  `json:"productId"`
	VariantID *string `json:"variantId"`
	Name      string  `json:"name"`
	PriceKES  string  `json:"priceKes"`
	StoreSlug string  `json:"storeSlug"`
	StoreName string  `json:"storeName"`
}

// StoreHit resolves a store QR (esoqo://s) or slug.
type StoreHit struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// TableHit resolves a restaurant table QR: the menu (store) plus which
// table the diner sits at. The client opens the store menu with the
// table label attached (checkout carries it as the collection note).
type TableHit struct {
	StoreSlug  string `json:"storeSlug"`
	StoreName  string `json:"storeName"`
	TableLabel string `json:"tableLabel"`
}

// TicketHit is the passenger/guest-safe view of an event ticket: what
// it is, whether it's still valid, and where it's for. Gate check-in
// itself stays behind the org's /checkin capability (ticket.checkin).
type TicketHit struct {
	TicketID  string  `json:"ticketId"`
	Code      string  `json:"code"`
	Status    string  `json:"status"`
	ClassName string  `json:"className"`
	SeatLabel *string `json:"seatLabel"`
	PriceKES  string  `json:"priceKes"`
	EventName string  `json:"eventName"`
	OrgName   string  `json:"orgName"`
}

// OrderHit resolves a store pickup code: the status a buyer or shop
// staff sees when pointing at the printed sticker. Public-safe because
// the code itself is the bearer credential for "collect this order".
type OrderHit struct {
	OrderID    string  `json:"orderId"`
	PickupCode string  `json:"pickupCode"`
	Status     string  `json:"status"`
	StoreName  string  `json:"storeName"`
	TotalKES   string  `json:"totalKes"`
	ReadyAt    *string `json:"readyAt"`
}

// PartyHit resolves an Esoqo Payment ID (ESK-…-KE): the public handle
// card — what a peer or a same-store register sees when the card's QR
// is pointed at them, before any payment happens.
type PartyHit struct {
	EsoqoID      string `json:"esoqoId"`
	DisplayName  string `json:"displayName"`
	Verified     bool   `json:"verified"`
	Organisation bool   `json:"organisation"`
}

// CertificateHit mirrors the public /verify page's VerifyResult (see
// packages/db/src/dal/reference.ts) so a phone scan answers the same
// "is this credential real" question a typed code does on the website.
type CertificateHit struct {
	Found      bool    `json:"found"`
	Status     string  `json:"status"`
	ClaimType  string  `json:"claimType"`
	Holder     string  `json:"holder"`
	Issuer     string  `json:"issuer"`
	IssuedOn   string  `json:"issuedOn"`
	ValidUntil *string `json:"validUntil"`
}

// ResolveScan sniffs one raw code and dispatches: esoqo:// scheme first
// (or the legacy esoko:// spelling still on printed codes)
// (signed trip/voucher payloads, table/store/product links), then the
// registered short-code prefixes, then SKU/fare/certificate. Unknown
// input answers unknown — never an error — so the scanner UI can say
// "not an Esoqo code" instead of failing.
func ResolveScan(ctx context.Context, pool *pgxpool.Pool, raw, qrSecret string, ttlMin int) (*ScanHit, error) {
	code := strings.TrimSpace(raw)
	if code == "" {
		return unknownHit(), nil
	}

	// Signed trip boarding payload.
	if _, ok := fleetqr.TrimScheme(code, "t"); ok {
		if trip, err := ResolveTripQr(ctx, pool, code, qrSecret); err == nil {
			return hit(ScanKindTrip, trip), nil
		}
		// Bad signature or closed trip — a wrong/expired code, not a
		// different kind. Don't fall through to fare/SKU matching.
		return unknownHit(), nil
	}

	// Voucher payload → public card (open wallet).
	if _, ok := fleetqr.TrimScheme(code, "v"); ok {
		if v, err := resolveVoucherPublic(ctx, pool, code); err == nil {
			return hit(ScanKindVoucher, v), nil
		}
		return unknownHit(), nil
	}

	// Table QR: esoqo://table?store=<slug>&table=<label>.
	if q, ok := fleetqr.TrimScheme(code, "table"); ok {
		params := map[string]string{}
		for _, part := range strings.Split(q, "&") {
			k, v, _ := strings.Cut(part, "=")
			params[k] = v
		}
		if slug := params["store"]; slug != "" {
			var name string
			if err := pool.QueryRow(ctx, `SELECT name FROM store WHERE slug = $1 AND status = 'ACTIVE'`, slug).Scan(&name); err == nil {
				return hit(ScanKindTable, &TableHit{StoreSlug: slug, StoreName: name, TableLabel: params["table"]}), nil
			}
		}
		return unknownHit(), nil
	}

	// Store QR: esoqo://s?slug= (or a bare slug).
	if q, ok := fleetqr.TrimScheme(code, "s"); ok {
		for _, part := range strings.Split(q, "&") {
			if k, v, _ := strings.Cut(part, "="); k == "slug" && v != "" {
				var name string
				if err := pool.QueryRow(ctx, `SELECT name FROM store WHERE slug = $1 AND status = 'ACTIVE'`, v).Scan(&name); err == nil {
					return hit(ScanKindStore, &StoreHit{Slug: v, Name: name}), nil
				}
			}
		}
		return unknownHit(), nil
	}

	// Product QR: esoqo://p?id=<product uuid>.
	if q, ok := fleetqr.TrimScheme(code, "p"); ok {
		for _, part := range strings.Split(q, "&") {
			if k, v, _ := strings.Cut(part, "="); k == "id" && v != "" {
				if ph, err := productByID(ctx, pool, v); err == nil && ph != nil {
					return hit(ScanKindProduct, ph), nil
				}
			}
		}
		return unknownHit(), nil
	}

	// Registered short-code prefixes — the namespace table, not a chain
	// of ifs. A typed/printed code that starts with one of ours and does
	// not resolve is a typo or a retired code, never another Esoqo kind,
	// so a failed match here means unknown, full stop.
	upper := strings.ToUpper(code)
	for _, reg := range shortCodePrefixes {
		if !strings.HasPrefix(upper, reg.prefix) {
			continue
		}
		if reg.checkedLen > 0 && isChecksumTypo(upper, reg.prefix, reg.checkedLen) {
			return unknownHit(), nil
		}
		if h := resolveShortCode(ctx, pool, reg.kind, code, qrSecret); h != nil {
			return h, nil
		}
		return unknownHit(), nil
	}

	// Raw digits / SKU off a shelf barcode (mall self-checkout): variant
	// SKU is the cashier-equivalent key.
	if ph, err := productBySKU(ctx, pool, code); err == nil && ph != nil {
		return hit(ScanKindProduct, ph), nil
	}

	// Fare receipt / M-Pesa code → public proof (TTL-gated, no PII).
	if proof, err := FareProofForCode(ctx, pool, code, ttlMin); err == nil && proof.Status != "NOT_FOUND" {
		return hit(ScanKindFare, proof), nil
	}

	// Printed certificate code — the attestation id's short form (see
	// packages/db/src/dal/reference.ts): hex-only, prefix-matched. It
	// has no registered prefix, so it is tried last and only when it
	// cannot be anything else.
	if isHexish(upper) && len(upper) >= 8 {
		if cert, err := ResolveCertificateByCode(ctx, pool, code); err == nil && cert.Found {
			return hit(ScanKindCertificate, cert), nil
		}
	}

	return unknownHit(), nil
}

// isChecksumTypo reports whether upper is the NEW checked shape for a
// registered short code but fails its checksum — i.e. a mistype, safe to
// reject before hitting the DB. Old unchecked codes (one char shorter)
// and foreign strings are left alone; the DB remains authoritative.
func isChecksumTypo(upper, prefix string, n int) bool {
	head := prefix
	if len(upper) != len(head)+n+1 {
		return false
	}
	seg := upper[len(head) : len(head)+n]
	return upper != head+fleetqr.WithCheck(seg)
}

func isHexish(s string) bool {
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

func resolveShortCode(ctx context.Context, pool *pgxpool.Pool, kind, code, qrSecret string) *ScanHit {
	switch kind {
	case ScanKindTrip:
		if trip, err := ResolveTripQr(ctx, pool, code, qrSecret); err == nil {
			return hit(kind, trip)
		}
	case ScanKindVoucher:
		if v, err := resolveVoucherPublic(ctx, pool, code); err == nil {
			return hit(kind, v)
		}
	case ScanKindTicket:
		if t, err := ResolveTicketByCode(ctx, pool, code); err == nil && t != nil {
			return hit(kind, t)
		}
	case ScanKindOrder:
		if o, err := ResolveOrderByPickupCode(ctx, pool, code); err == nil && o != nil {
			return hit(kind, o)
		}
	case ScanKindParty:
		if p, err := ResolvePartyByPaymentID(ctx, pool, code); err == nil && p != nil {
			return hit(kind, p)
		}
	case ScanKindParcel:
		if p, err := GetParcelStatus(ctx, pool, code); err == nil && p != nil {
			return hit(kind, p)
		}
	case ScanKindLuggage:
		// Guest-safe by construction: a luggage stub lives in a coat
		// pocket and whoever holds it may scan it, so this projection
		// carries the surname-and-initial form and nothing else. Crew
		// detail stays behind ListTripLuggage's capability check.
		if l, err := ResolveLuggageByCode(ctx, pool, code); err == nil && l != nil {
			return hit(kind, l)
		}
	}
	return nil
}

func resolveVoucherPublic(ctx context.Context, pool *pgxpool.Pool, code string) (*VoucherPublic, error) {
	v, err := ResolveVoucherByCode(ctx, pool, code)
	if err != nil {
		return nil, err
	}
	return &VoucherPublic{
		ShortCode: v.ShortCode, Label: v.Label, Purpose: v.Purpose,
		Status: v.Status, BalancePoints: v.BalancePoints, BalanceKES: v.BalanceKES,
	}, nil
}

// ResolveTicketByCode — TKT-… → the ticket's public stub. Public-safe:
// ticket class, seat, event and status only; buyer PII stays out.
func ResolveTicketByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*TicketHit, error) {
	var h TicketHit
	err := pool.QueryRow(ctx, `
		SELECT t.id::text, t.code, t.status::text, tc.name, s.label, t."priceKes"::text, l.title, o.name
		FROM ticket t
		JOIN ticket_class tc ON tc.id = t."ticketClassId"
		JOIN booking b ON b.id = t."bookingId"
		JOIN listing_schedule ls ON ls.id = b."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		JOIN ticket_org o ON o.id = l."orgId"
		LEFT JOIN seat s ON s.id = t."seatId"
		WHERE t.code = $1
		LIMIT 1`, strings.ToUpper(strings.TrimSpace(code))).
		Scan(&h.TicketID, &h.Code, &h.Status, &h.ClassName, &h.SeatLabel, &h.PriceKES, &h.EventName, &h.OrgName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// ResolveOrderByPickupCode — PKP-… → the buyer/staff-facing pickup
// status card. Uses the same shared orderStatusSelect as the buyer's
// order-detail screen; the pickup code is the bearer credential.
func ResolveOrderByPickupCode(ctx context.Context, pool *pgxpool.Pool, code string) (*OrderHit, error) {
	o, err := scanOrderStatus(pool.QueryRow(ctx, orderStatusSelect+`
		WHERE so."pickupCode" = $1
		LIMIT 1`, strings.ToUpper(strings.TrimSpace(code))))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if o.PickupCode == nil {
		return nil, nil
	}
	return &OrderHit{
		OrderID:    o.ID,
		PickupCode: *o.PickupCode,
		Status:     o.Status,
		StoreName:  o.StoreName,
		TotalKES:   o.TotalKES,
		ReadyAt:    o.ReadyAt,
	}, nil
}

// ResolvePartyByPaymentID — ESK-…-KE → the public payment card: who
// holds it, whether the number is verified, and whether it's a person
// or a business. No msisdn, no contact detail — just enough for a peer
// to know they're paying the right entity.
func ResolvePartyByPaymentID(ctx context.Context, pool *pgxpool.Pool, code string) (*PartyHit, error) {
	var h PartyHit
	// The name chain is person-then-organisation, per
	// docs/proposals/universal-scan-and-code-mint.md §party. Both joins
	// are needed: a business Party has no `person` row, so with only the
	// person join every business resolved to the fallback and a shop
	// would have rendered to a customer as "Esoqo member" — the exact
	// case a customer cannot tell from a personal payment. An
	// ORGANISATION also cannot hold MSISDN_VERIFIED, so `Verified` is
	// false for a business by construction and the UI must not read
	// that as "suspicious".
	err := pool.QueryRow(ctx, `
		SELECT p.code,
		       COALESCE(pe."knownAs", pe."officialName",
		                org."knownAs", org."officialName", 'Withheld'),
		       EXISTS (
		         SELECT 1 FROM attestation a
		         WHERE a."subjectId" = pa.id
		           AND a."claimType" = 'MSISDN_VERIFIED'
		           AND a."revokedAt" IS NULL
		       ),
		       pa.kind = 'ORGANISATION'
		FROM esoko_payment_id p
		JOIN party pa ON pa.id = p."partyId"
		LEFT JOIN person pe ON pe."partyId" = pa.id
		LEFT JOIN organisation org ON org."partyId" = pa.id
		WHERE p.code = $1
		LIMIT 1`, strings.ToUpper(strings.TrimSpace(code))).
		Scan(&h.EsoqoID, &h.DisplayName, &h.Verified, &h.Organisation)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// ResolveCertificateByCode mirrors packages/db/src/dal/reference.ts's
// verifyCertificate: the printed code is a prefix of the attestation's
// id (dashes stripped). Public by design — a buyer or a county officer
// verifying a credential needs zero account.
func ResolveCertificateByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*CertificateHit, error) {
	clean := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	if len(clean) < 4 {
		return &CertificateHit{Found: false}, nil
	}
	var claimType, issuedAt string
	var expiresAt, revokedAt, knownAs, officialName, orgName, issuerName *string
	err := pool.QueryRow(ctx, `
		SELECT a."claimType"::text, a."issuedAt"::text, a."expiresAt"::text, a."revokedAt"::text,
		       pe."knownAs", pe."officialName", o."officialName", i.name
		FROM attestation a
		LEFT JOIN person pe ON pe."partyId" = a."subjectId"
		LEFT JOIN organisation o ON o."partyId" = a."subjectId"
		LEFT JOIN issuer i ON i.id = a."issuerOrgId"
		WHERE replace(a.id::text, '-', '') ILIKE $1 || '%'
		ORDER BY a."issuedAt" DESC
		LIMIT 1`, clean).
		Scan(&claimType, &issuedAt, &expiresAt, &revokedAt, &knownAs, &officialName, &orgName, &issuerName)
	if errors.Is(err, pgx.ErrNoRows) {
		return &CertificateHit{Found: false}, nil
	}
	if err != nil {
		return nil, err
	}

	h := &CertificateHit{Found: true, Status: "valid"}
	if revokedAt != nil {
		h.Status = "revoked"
	} else if t, ok := parseTime(expiresAt); ok && time.Now().After(t) {
		h.Status = "expired"
	} else if t, ok := parseTime(expiresAt); ok && time.Until(t) < 60*24*time.Hour {
		h.Status = "expiring"
	}

	if e, ok := parseTime(expiresAt); ok {
		iso := e.UTC().Format(time.RFC3339)
		h.ValidUntil = &iso
	}
	if issuerName != nil && *issuerName != "" {
		h.Issuer = *issuerName
	} else {
		h.Issuer = "Esoqo"
	}

	// Holder: prefer what the person actually goes by, then official
	// name, then the org name — withdrawn once revoked, like the site.
	h.ClaimType = prettifyClaimType(claimType)
	switch {
	case revokedAt != nil:
		h.Holder = "[withheld]"
	case knownAs != nil && *knownAs != "":
		h.Holder = *knownAs
	case officialName != nil && *officialName != "":
		h.Holder = *officialName
	case orgName != nil && *orgName != "":
		h.Holder = *orgName
	default:
		h.Holder = "Withheld"
	}
	if t, ok := parseTime(&issuedAt); ok {
		h.IssuedOn = t.UTC().Format(time.RFC3339)
	}
	return h, nil
}

func parseTime(s *string) (time.Time, bool) {
	if s == nil || *s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, *s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func prettifyClaimType(s string) string {
	s = strings.ToLower(strings.ReplaceAll(s, "_", " "))
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func productByID(ctx context.Context, pool *pgxpool.Pool, productID string) (*ProductHit, error) {
	var h ProductHit
	err := pool.QueryRow(ctx, `
		SELECT p.id::text, p.name, p."priceKes"::text, s.slug, s.name
		FROM product p JOIN store s ON s.id = p."storeId"
		WHERE p.id = $1 AND p.status = 'ACTIVE' AND s.status = 'ACTIVE'`, productID).
		Scan(&h.ProductID, &h.Name, &h.PriceKES, &h.StoreSlug, &h.StoreName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func productBySKU(ctx context.Context, pool *pgxpool.Pool, sku string) (*ProductHit, error) {
	var h ProductHit
	err := pool.QueryRow(ctx, `
		SELECT p.id::text, pv.id::text, p.name || ' — ' || pv.label, pv."priceKes"::text, s.slug, s.name
		FROM product_variant pv
		JOIN product p ON p.id = pv."productId"
		JOIN store s ON s.id = p."storeId"
		WHERE pv.sku = $1 AND p.status = 'ACTIVE' AND s.status = 'ACTIVE'
		LIMIT 1`, strings.TrimSpace(sku)).
		Scan(&h.ProductID, &h.VariantID, &h.Name, &h.PriceKES, &h.StoreSlug, &h.StoreName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}
