package dbx

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VerifyResult is the tout-facing answer for a scanned/typed code.
type VerifyResult struct {
	Status        string // VALID | EXPIRED | NOT_FOUND | PENDING | FAILED | WRONG_TRIP | SUSPECT_REUSE
	FareID        string
	AmountKES     string
	Method        string
	BuyerMsisdn   *string
	ReceiptCode   *string
	AgeMinutes    int
	TripID        string
	VehiclePlate  *string
	RouteName     *string
	DriverName    *string
	ConductorName *string
	OrgName       string
	VerifyCount   int
}

// LookupFareByCode resolves fare uuid, mpesa receipt, or short id prefix
// from "just the code" the passenger shows the tout.
func LookupFareByCode(ctx context.Context, pool *pgxpool.Pool, code string) (fareID string, err error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return "", ErrFareNotFound
	}
	upper := strings.ToUpper(code)
	// Exact: fare id, receipt, checkout id.
	err = pool.QueryRow(ctx, `
		SELECT id::text FROM fare_payment
		WHERE id::text = $1 OR UPPER(COALESCE("mpesaReceiptCode",'')) = $2
		   OR COALESCE("mpesaCheckoutRequestId",'') = $1
		LIMIT 1`, code, upper).Scan(&fareID)
	if err == nil {
		return fareID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	// Prefix: first 8 of the uuid (what receipts print).
	if len(code) >= 6 {
		err = pool.QueryRow(ctx, `SELECT id::text FROM fare_payment WHERE id::text ILIKE $1 LIMIT 1`, code+"%").Scan(&fareID)
		if err == nil {
			return fareID, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	return "", ErrFareNotFound
}

// VerifyFare checks a fare for a tout: CONFIRMED + within TTL + trip match.
// Always logs the attempt for reuse analytics (best-effort).
//
// Visibility rule (least privilege): privileged callers (fare.verify or
// ticketorg.read — crew, scanners, managers, staff) see any fare.
// Everyone else sees only fares they paid themselves (matched by party
// or msisdn); anything else answers NOT_FOUND, never a denial oracle.
func VerifyFare(ctx context.Context, pool *pgxpool.Pool, code, scopeTripID string, ttlMin int, verifierParty, verifierAgent, requesterParty, requesterMsisdn string, privileged bool) (*VerifyResult, error) {
	fareID, err := LookupFareByCode(ctx, pool, code)
	if errors.Is(err, ErrFareNotFound) {
		return &VerifyResult{Status: "NOT_FOUND"}, nil
	}
	if err != nil {
		return nil, err
	}
	var r VerifyResult
	var status, createdAt, confirmedAt, tripID string
	var amount, method string
	var msisdn, receipt, buyerParty *string
	err = pool.QueryRow(ctx, `
		SELECT id::text, status::text, "amountKes"::text, method, "buyerMsisdn", "mpesaReceiptCode", "tripId"::text, "createdAt"::text, COALESCE("confirmedAt"::text,''), "buyerPartyId"::text FROM fare_payment WHERE id = $1`, fareID).
		Scan(&r.FareID, &status, &amount, &method, &msisdn, &receipt, &tripID, &createdAt, &confirmedAt, &buyerParty)
	if err != nil {
		return nil, err
	}
	if !privileged && !ownsFare(buyerParty, msisdn, requesterParty, requesterMsisdn) {
		return &VerifyResult{Status: "NOT_FOUND"}, nil
	}
	r.AmountKES, r.Method, r.BuyerMsisdn, r.ReceiptCode, r.TripID = amount, method, msisdn, receipt, tripID

	base := createdAt
	if confirmedAt != "" {
		base = confirmedAt
	}
	t, err := time.Parse(time.RFC3339, base)
	if err != nil {
		t, _ = time.Parse("2006-01-02 15:04:05", base)
	}
	if t.IsZero() {
		t, _ = time.Parse("2006-01-02T15:04:05Z", base)
	}
	age := int(time.Since(t).Minutes())
	if age < 0 {
		age = 0
	}
	r.AgeMinutes = age

	_ = pool.QueryRow(ctx, `
		SELECT v."plateNo", r2.name, d.name, co.name, o.name
		FROM trip t JOIN fleet_vehicle v ON v.id = t."vehicleId"
		LEFT JOIN short_route r2 ON r2.id = t."shortRouteId"
		LEFT JOIN crew_member d ON d.id = t."driverId"
		LEFT JOIN crew_member co ON co.id = t."conductorId"
		JOIN ticket_org o ON o.id = t."orgId" WHERE t.id = $1`, tripID).
		Scan(&r.VehiclePlate, &r.RouteName, &r.DriverName, &r.ConductorName, &r.OrgName)
	_ = pool.QueryRow(ctx, `SELECT count(*)::int FROM fare_verification WHERE "fareId" = $1`, fareID).Scan(&r.VerifyCount)

	result := "VALID"
	switch {
	case status == "PENDING":
		result = "PENDING"
	case status == "FAILED":
		result = "FAILED"
	case ttlMin > 0 && age > ttlMin:
		result = "EXPIRED"
	case scopeTripID != "" && scopeTripID != tripID:
		result = "WRONG_TRIP"
	case r.VerifyCount >= 3:
		result = "SUSPECT_REUSE"
	}
	r.Status = result
	_, _ = pool.Exec(ctx, `INSERT INTO fare_verification (id, "fareId", "verifierPartyId", "verifierAgentId", "scopeTripId", result, "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())`,
		fareID, nullStr(verifierParty), nullStr(verifierAgent), nullStr(scopeTripID), result)
	r.VerifyCount++
	return &r, nil
}

func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// ownsFare matches a fare to the requester by party id or verified msisdn.
func ownsFare(buyerParty, buyerMsisdn *string, requesterParty, requesterMsisdn string) bool {
	if requesterParty != "" && buyerParty != nil && *buyerParty == requesterParty {
		return true
	}
	if requesterMsisdn != "" && buyerMsisdn != nil && *buyerMsisdn == requesterMsisdn {
		return true
	}
	return false
}

// PublicFareProof is the receipt anyone holding the QR may see: TTL-gated
// validity + amount + bus identity. Never msisdn, never crew PII — the QR
// itself is the secret, and full details stay behind VerifyFare's rule.
type PublicFareProof struct {
	Status       string  `json:"status"` // VALID | EXPIRED | PENDING | FAILED | NOT_FOUND
	FareRef      string  `json:"fareRef"`
	AmountKES    string  `json:"amountKes"`
	AgeMinutes   int     `json:"ageMinutes"`
	VehiclePlate *string `json:"vehiclePlate"`
	RouteName    *string `json:"routeName"`
	OrgName      string  `json:"orgName"`
}

// FareProofForCode resolves "just the code" to a public proof.
func FareProofForCode(ctx context.Context, pool *pgxpool.Pool, code string, ttlMin int) (*PublicFareProof, error) {
	fareID, err := LookupFareByCode(ctx, pool, code)
	if errors.Is(err, ErrFareNotFound) {
		return &PublicFareProof{Status: "NOT_FOUND"}, nil
	}
	if err != nil {
		return nil, err
	}
	var p PublicFareProof
	var status, createdAt, confirmedAt, tripID, amount string
	err = pool.QueryRow(ctx, `
		SELECT status::text, "amountKes"::text, "tripId"::text, "createdAt"::text, COALESCE("confirmedAt"::text,'') FROM fare_payment WHERE id = $1`, fareID).
		Scan(&status, &amount, &tripID, &createdAt, &confirmedAt)
	if err != nil {
		return nil, err
	}
	p.FareRef = fareID[:8]
	p.AmountKES = amount
	base := createdAt
	if confirmedAt != "" {
		base = confirmedAt
	}
	t, terr := time.Parse(time.RFC3339, base)
	if terr != nil {
		t, _ = time.Parse("2006-01-02 15:04:05", base)
	}
	age := int(time.Since(t).Minutes())
	if age < 0 {
		age = 0
	}
	p.AgeMinutes = age
	_ = pool.QueryRow(ctx, `
		SELECT v."plateNo", r2.name, o.name
		FROM trip t JOIN fleet_vehicle v ON v.id = t."vehicleId"
		LEFT JOIN short_route r2 ON r2.id = t."shortRouteId"
		JOIN ticket_org o ON o.id = t."orgId" WHERE t.id = $1`, tripID).
		Scan(&p.VehiclePlate, &p.RouteName, &p.OrgName)
	switch {
	case status == "PENDING":
		p.Status = "PENDING"
	case status == "FAILED":
		p.Status = "FAILED"
	case ttlMin > 0 && age > ttlMin:
		p.Status = "EXPIRED"
	default:
		p.Status = "VALID"
	}
	return &p, nil
}
