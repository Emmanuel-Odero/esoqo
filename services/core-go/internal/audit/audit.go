// Package audit ports packages/db/src/audit.ts's append-only hash chain
// to Go. Each row's hash covers the previous row's hash plus a canonical
// (recursively key-sorted) serialisation of the row — sorting matters
// because Postgres jsonb does not preserve insertion order, and a hash
// computed at write time from Go's own JSON marshalling must agree with
// one recomputed at verify time from a re-read jsonb value.
package audit

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Row struct {
	OccurredAt string      `json:"occurredAt"`
	ActorType  string      `json:"actorType"`
	ActorID    *string     `json:"actorId"`
	Action     string      `json:"action"`
	TargetType *string     `json:"targetType"`
	TargetID   *string     `json:"targetId"`
	Payload    interface{} `json:"payload"`
	IP         *string     `json:"ip"`
}

// sortDeep recursively sorts map keys so canonical() is independent of
// whatever order any layer (including Postgres jsonb) hands keys back in.
func sortDeep(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		// The TS original only drops keys whose value is `undefined` — a
		// JS/JSON distinction Go's json package doesn't have, since a Go
		// map decoded from JSON never contains an "undefined" sentinel,
		// only present-with-null or absent. So every key surviving the
		// json.Unmarshal round trip (including ones holding JSON null,
		// e.g. a genuinely absent actorId) must be kept and sorted, not
		// filtered — dropping nils here would silently disagree with
		// every hash computed on the TS side against a row containing one.
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]interface{}, len(keys))
		for _, k := range keys {
			out[k] = sortDeep(val[k])
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(val))
		for i, vv := range val {
			out[i] = sortDeep(vv)
		}
		return out
	default:
		return v
	}
}

// toISOString reproduces JavaScript's Date.prototype.toISOString() exactly
// — always exactly 3 fractional-second digits and a literal "Z" — because
// the hash was originally computed against that format on the TS side
// (recordAudit's row.occurredAt = occurredAt.toISOString()) and Go's own
// RFC3339Nano trims/pads differently, which would silently disagree with
// every existing row's hash.
func toISOString(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// marshalNoEscape is json.Marshal without Go's default HTML-escaping of
// `<`, `>` and `&` — JS's JSON.stringify (what the hash was originally
// computed with) never escapes them, so leaving Go's default on would
// disagree with every existing hash on any payload containing one of
// those characters (e.g. "Poultry, dairy & eggs").
func marshalNoEscape(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	// Encoder.Encode appends a trailing newline; JSON.stringify does not.
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func canonical(row Row) (string, error) {
	// Round-trip through a generic map so nested payload keys sort too.
	raw, err := marshalNoEscape(row)
	if err != nil {
		return "", err
	}
	var generic map[string]interface{}
	if err := json.Unmarshal(raw, &generic); err != nil {
		return "", err
	}
	sorted := sortDeep(generic)
	out, err := marshalNoEscape(sorted)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func link(prevHash string, row Row) (string, error) {
	c, err := canonical(row)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(prevHash))
	h.Write([]byte(c))
	return hex.EncodeToString(h.Sum(nil)), nil
}

func seedHash(seed string) string {
	h := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(h[:])
}

type CtxLike struct {
	ActorType string
	ActorID   *string
	IP        *string
}

type Input struct {
	Action     string
	TargetType *string
	TargetID   *string
	Payload    map[string]interface{}
}

// RecordAudit writes one audit event. Phase 0 takes the pool directly;
// later phases that need the audit row in the same transaction as the
// change it describes should widen this to accept pgx.Tx too (both
// satisfy the same Query/QueryRow/Exec shape).
func RecordAudit(ctx context.Context, pool *pgxpool.Pool, chainSeed string, actor CtxLike, in Input) (string, error) {
	var lastHash *string
	err := pool.QueryRow(ctx, `SELECT hash FROM audit_event ORDER BY id DESC LIMIT 1`).Scan(&lastHash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	prevHash := seedHash(chainSeed)
	if lastHash != nil {
		prevHash = *lastHash
	}

	occurredAt := time.Now().UTC()
	row := Row{
		OccurredAt: toISOString(occurredAt),
		ActorType:  actor.ActorType,
		ActorID:    actor.ActorID,
		Action:     in.Action,
		TargetType: in.TargetType,
		TargetID:   in.TargetID,
		Payload:    in.Payload,
		IP:         actor.IP,
	}
	if row.Payload == nil {
		row.Payload = map[string]interface{}{}
	}
	hash, err := link(prevHash, row)
	if err != nil {
		return "", err
	}

	payloadJSON, err := json.Marshal(row.Payload)
	if err != nil {
		return "", err
	}

	// Prisma leaves every AuditEvent field at its default camelCase column
	// name (only the table itself gets @@map("audit_event")) — so, unlike
	// a snake_case schema, these identifiers must be quoted or Postgres
	// folds them to lowercase and the insert fails against the real table.
	_, err = pool.Exec(ctx, `
		INSERT INTO audit_event ("occurredAt", "actorType", "actorId", action, "targetType", "targetId", payload, ip, "prevHash", hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		occurredAt, row.ActorType, row.ActorID, row.Action, row.TargetType, row.TargetID, payloadJSON, row.IP, prevHash, hash)
	if err != nil {
		return "", err
	}
	return hash, nil
}

type ChainResult struct {
	OK           bool
	Checked      int
	BrokenAtID   *string
	BrokenAtTime *time.Time
}

// VerifyChain walks the whole table in id order, recomputing each row's
// expected prevHash/hash. Used by GET /ready.
func VerifyChain(ctx context.Context, pool *pgxpool.Pool, chainSeed string, batchSize int) (ChainResult, error) {
	if batchSize <= 0 {
		batchSize = 1000
	}
	expectedPrev := seedHash(chainSeed)
	checked := 0
	var cursor *int64

	for {
		rows, err := pool.Query(ctx, `
			SELECT id, "occurredAt", "actorType", "actorId", action, "targetType", "targetId", payload, ip, "prevHash", hash
			FROM audit_event
			WHERE ($1::bigint IS NULL OR id > $1)
			ORDER BY id ASC
			LIMIT $2`, cursor, batchSize)
		if err != nil {
			return ChainResult{}, err
		}

		count := 0
		for rows.Next() {
			var id int64
			var occurredAt time.Time
			var actorType, action, prevHash, hash string
			var actorID, targetType, targetID, ip *string
			var payload []byte
			if err := rows.Scan(&id, &occurredAt, &actorType, &actorID, &action, &targetType, &targetID, &payload, &ip, &prevHash, &hash); err != nil {
				rows.Close()
				return ChainResult{}, err
			}

			var payloadVal interface{}
			if err := json.Unmarshal(payload, &payloadVal); err != nil {
				rows.Close()
				return ChainResult{}, err
			}

			if prevHash != expectedPrev {
				rows.Close()
				idStr := itoa(id)
				return ChainResult{OK: false, Checked: checked, BrokenAtID: &idStr, BrokenAtTime: &occurredAt}, nil
			}
			recomputed, err := link(prevHash, Row{
				OccurredAt: toISOString(occurredAt),
				ActorType:  actorType,
				ActorID:    actorID,
				Action:     action,
				TargetType: targetType,
				TargetID:   targetID,
				Payload:    payloadVal,
				IP:         ip,
			})
			if err != nil {
				rows.Close()
				return ChainResult{}, err
			}
			if recomputed != hash {
				rows.Close()
				idStr := itoa(id)
				return ChainResult{OK: false, Checked: checked, BrokenAtID: &idStr, BrokenAtTime: &occurredAt}, nil
			}
			expectedPrev = hash
			checked++
			cursor = &id
			count++
		}
		rows.Close()
		if count == 0 {
			break
		}
	}

	return ChainResult{OK: true, Checked: checked}, nil
}

func itoa(id int64) string {
	if id == 0 {
		return "0"
	}
	neg := id < 0
	if neg {
		id = -id
	}
	var buf [20]byte
	i := len(buf)
	for id > 0 {
		i--
		buf[i] = byte('0' + id%10)
		id /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
