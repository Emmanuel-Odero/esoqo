// Package dbx (parcel_couriers.go) — the formal courier role. Before
// this, "assigning a collector" (see parcels.go's AssignParcelCollector/
// CollectorLite) just meant picking any existing Party with a phone;
// this file is what turns "a courier" into a real, vetted, activatable
// identity — onboarding, status, and computed performance, all read
// from tables that already exist (parcel/parcel_handoff), same "don't
// track what you can compute" philosophy GetAdminParcelStats follows.
package dbx

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ParcelCourierError struct {
	Code    string // BAD_INPUT | NOT_FOUND | ALREADY_ONBOARDED
	Message string
}

func (e *ParcelCourierError) Error() string { return e.Message }

// ParcelCourierRow — one line on the admin couriers list, including the
// Person fields a courier is otherwise just a partyId, and the status/
// vehicle a dispatcher needs to decide who to hand a job to.
type ParcelCourierRow struct {
	ID          string
	PartyID     string
	Name        string
	Msisdn      *string
	VehicleType string
	Status      string
	VettingNote *string
	ActivatedAt *time.Time
	SuspendedAt *time.Time
	CreatedAt   time.Time
}

const parcelCourierColumns = `
	c.id, c."partyId", COALESCE(pr."knownAs", pr."officialName"), pr.msisdn,
	c."vehicleType"::text, c.status::text, c."vettingNote", c."activatedAt", c."suspendedAt", c."createdAt"`

func scanParcelCourierRow(row pgx.Row) (*ParcelCourierRow, error) {
	var r ParcelCourierRow
	if err := row.Scan(&r.ID, &r.PartyID, &r.Name, &r.Msisdn, &r.VehicleType,
		&r.Status, &r.VettingNote, &r.ActivatedAt, &r.SuspendedAt, &r.CreatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

// OnboardCourier — a staff member turning an existing Party (found via
// the same SearchCollectorParties lookup AssignParcelCollector's admin
// panel already uses) into a courier, PENDING_VETTING until a status
// change activates them. One courier profile per Party — re-onboarding
// an existing courier is a BAD_INPUT, not silently ignored, since a
// staffer probably meant to change their status/vehicle instead.
func OnboardCourier(ctx context.Context, pool *pgxpool.Pool, partyID, vehicleType string) (courierID string, err error) {
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM parcel_courier WHERE "partyId" = $1)`, partyID).Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return "", &ParcelCourierError{"ALREADY_ONBOARDED", "This person is already a courier"}
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO parcel_courier (id, "partyId", "vehicleType", status, "createdAt")
		VALUES (gen_random_uuid(), $1, $2::"ParcelTransportMode", 'PENDING_VETTING', now())
		RETURNING id`, partyID, vehicleType).Scan(&courierID)
	return courierID, err
}

var validVehicleTypes = map[string]bool{
	"BODA": true, "TUKTUK": true, "VAN": true, "TRUCK": true, "BICYCLE": true, "ON_FOOT": true,
}

// AdminAddCourierInput is what a staffer types in to add someone who's
// never touched the Esoko app before — team name, contact, phone.
type AdminAddCourierInput struct {
	Name        string
	Msisdn      string
	Email       *string
	VehicleType string
}

// AdminAddCourier is the "just add them" path: unlike OnboardCourier
// (which turns an *existing* Party into a courier — the search-first
// flow the assign panel already uses), this creates the Party+Person
// too, straight from the name/phone/vehicle a staffer types in for a
// courier team member who's never signed up. Idempotent on phone
// number — a msisdn that already has a Person on file reuses it
// (updating the name/email to what was just entered, since an
// admin-supplied real name is better than whatever placeholder or
// stale value was there) rather than erroring or creating a duplicate.
// Also mints their Esoko ID and texts them a welcome/confirmation —
// see notify.CourierOnboarded — so the same SMS both confirms their
// number is right and gives them the ID to sign in with.
func AdminAddCourier(ctx context.Context, pool *pgxpool.Pool, in AdminAddCourierInput) (courierID, partyID, esokoID string, err error) {
	if in.Name == "" || in.Msisdn == "" {
		return "", "", "", &ParcelCourierError{"BAD_INPUT", "Name and phone number are required"}
	}
	if !validVehicleTypes[in.VehicleType] {
		return "", "", "", &ParcelCourierError{"BAD_INPUT", "Choose a valid vehicle type"}
	}

	partyID, err = FindOrCreatePersonWithName(ctx, pool, in.Name, in.Msisdn, in.Email)
	if err != nil {
		return "", "", "", err
	}

	courierID, err = OnboardCourier(ctx, pool, partyID, in.VehicleType)
	if err != nil {
		return "", "", "", err
	}
	esokoID, err = EnsureEsokoPaymentId(ctx, pool, partyID, in.Msisdn)
	if err != nil {
		return "", "", "", err
	}
	return courierID, partyID, esokoID, nil
}

// SetCourierStatus — the vetting/suspend/reinstate/reject action, same
// "a staffer flips a status, we timestamp the transition" shape
// dbx.CancelParcel already follows for cancelledAt. activatedAt is set
// (once) the first time status becomes ACTIVE; suspendedAt is set every
// time it becomes SUSPENDED, so reinstating and re-suspending later
// still records the latest suspension.
func SetCourierStatus(ctx context.Context, pool *pgxpool.Pool, courierID, status string, note *string) error {
	var current string
	if err := pool.QueryRow(ctx, `SELECT status::text FROM parcel_courier WHERE id = $1`, courierID).Scan(&current); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &ParcelCourierError{"NOT_FOUND", "That courier was not found"}
		}
		return err
	}
	switch status {
	case "ACTIVE":
		_, err := pool.Exec(ctx, `
			UPDATE parcel_courier SET status = 'ACTIVE', "vettingNote" = $1,
			       "activatedAt" = COALESCE("activatedAt", now())
			WHERE id = $2`, note, courierID)
		return err
	case "SUSPENDED":
		_, err := pool.Exec(ctx, `
			UPDATE parcel_courier SET status = 'SUSPENDED', "vettingNote" = $1, "suspendedAt" = now()
			WHERE id = $2`, note, courierID)
		return err
	case "REJECTED", "PENDING_VETTING":
		_, err := pool.Exec(ctx, `
			UPDATE parcel_courier SET status = $1::"ParcelCourierStatus", "vettingNote" = $2 WHERE id = $3`,
			status, note, courierID)
		return err
	default:
		return &ParcelCourierError{"BAD_INPUT", "Not a valid courier status"}
	}
}

// ListCouriers — status is an exact filter (or every status when nil);
// q matches name/phone, same search-box shape AdminListParcels already
// follows.
func ListCouriers(ctx context.Context, pool *pgxpool.Pool, status, q *string) ([]ParcelCourierRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT `+parcelCourierColumns+`
		FROM parcel_courier c
		JOIN person pr ON pr."partyId" = c."partyId"
		WHERE ($1::text IS NULL OR c.status::text = $1)
		  AND ($2::text IS NULL OR pr."officialName" ILIKE '%'||$2||'%' OR pr."knownAs" ILIKE '%'||$2||'%' OR pr.msisdn ILIKE '%'||$2||'%')
		ORDER BY c."createdAt" DESC
		LIMIT 200`, status, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelCourierRow
	for rows.Next() {
		r, err := scanParcelCourierRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// ParcelCourierPerformance — computed entirely from parcel/parcel_handoff,
// never separately tracked (same reasoning GetAdminParcelStats already
// follows) — a courier's own delivered-count, on-time rate against
// Parcel.slaDeadlineAt, and the average condition rating receivers gave
// parcels they personally delivered (see dbx.ConfirmParcelReceipt).
type ParcelCourierPerformance struct {
	DeliveredCount     int      `json:"deliveredCount"`
	OnTimeCount        int      `json:"onTimeCount"`
	AvgConditionRating *float64 `json:"avgConditionRating"`
}

func GetCourierPerformance(ctx context.Context, pool *pgxpool.Pool, partyID string) (*ParcelCourierPerformance, error) {
	var perf ParcelCourierPerformance
	err := pool.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE p.status = 'DELIVERED'),
			count(*) FILTER (WHERE p.status = 'DELIVERED' AND (p."slaDeadlineAt" IS NULL OR p."deliveredAt" <= p."slaDeadlineAt")),
			avg(p."receiptConditionRating")::float8
		FROM parcel p
		WHERE p."currentHolderPartyId" = $1 AND p.status = 'DELIVERED'`, partyID).
		Scan(&perf.DeliveredCount, &perf.OnTimeCount, &perf.AvgConditionRating)
	if err != nil {
		return nil, err
	}
	return &perf, nil
}

// IsActiveCourier — the check ScanHandoff-adjacent flows (claim, the
// admin AssignPanel's search) use to make sure whoever's being handed a
// job is actually a vetted, active courier, not just any Party.
func IsActiveCourier(ctx context.Context, pool *pgxpool.Pool, partyID string) (bool, error) {
	var active bool
	err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM parcel_courier WHERE "partyId" = $1 AND status = 'ACTIVE')`, partyID).Scan(&active)
	return active, err
}

// SearchActiveCouriers — the admin AssignPanel's collector search, now
// scoped to real, active couriers instead of CollectorLite's "any Party
// with a phone" (see that type's own comment on why it used to be that
// broad).
func SearchActiveCouriers(ctx context.Context, pool *pgxpool.Pool, q string) ([]CollectorLite, error) {
	rows, err := pool.Query(ctx, `
		SELECT pr."partyId", COALESCE(pr."knownAs", pr."officialName"), pr.msisdn
		FROM parcel_courier c
		JOIN person pr ON pr."partyId" = c."partyId"
		WHERE c.status = 'ACTIVE'
		  AND (pr."officialName" ILIKE '%'||$1||'%' OR pr."knownAs" ILIKE '%'||$1||'%' OR pr.msisdn ILIKE '%'||$1||'%')
		ORDER BY pr."officialName"
		LIMIT 20`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CollectorLite
	for rows.Next() {
		var c CollectorLite
		if err := rows.Scan(&c.PartyID, &c.Name, &c.Msisdn); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
