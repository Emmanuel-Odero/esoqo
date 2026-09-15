package money

import (
	"encoding/json"
	"testing"
)

// The property the whole expand/contract migration rests on: an existing
// client that sends a JSON number must keep working unchanged.
func TestAmountUnmarshalsBothWireShapes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want Cents
	}{
		{"TS/Prisma string", `"254.15"`, 25415},
		{"core-go number", `254.15`, 25415},
		{"integer number", `1200`, 120000},
		{"integer string", `"1200"`, 120000},
		{"zero number", `0`, 0},
		{"zero string", `"0.00"`, 0},
		{"negative number", `-45.20`, -4520},
		{"negative string", `"-45.20"`, -4520},
		{"null is zero", `null`, 0},
		{"one decimal place", `"7.5"`, 750},
		{"string with separators", `"1,250.50"`, 125050},
		// A float64 that already drifted before it was serialised.
		{"drifted number", `254.14999999999998`, 25415},
		// Scientific notation, via the float64 fallback.
		{"scientific", `1e3`, 100000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var a Amount
			if err := json.Unmarshal([]byte(tc.in), &a); err != nil {
				t.Fatalf("Unmarshal(%s) errored: %v", tc.in, err)
			}
			if a.Cents() != tc.want {
				t.Errorf("Unmarshal(%s) = %d cents, want %d", tc.in, a.Cents(), tc.want)
			}
		})
	}
}

func TestAmountRejectsNonsense(t *testing.T) {
	for _, in := range []string{`"abc"`, `"1.2.3"`, `{}`, `[]`, `true`} {
		var a Amount
		if err := json.Unmarshal([]byte(in), &a); err == nil {
			t.Errorf("Unmarshal(%s) = nil error, want an error", in)
		}
	}
}

func TestAmountMarshalsAsDecimalString(t *testing.T) {
	cases := []struct {
		cents Cents
		want  string
	}{
		{0, `"0.00"`},
		{1, `"0.01"`},
		{-1, `"-0.01"`},
		{25050, `"250.50"`},
		{120000, `"1200.00"`},
		{-4520, `"-45.20"`},
	}
	for _, tc := range cases {
		got, err := json.Marshal(AmountOf(tc.cents))
		if err != nil {
			t.Fatalf("Marshal(%d) errored: %v", tc.cents, err)
		}
		if string(got) != tc.want {
			t.Errorf("Marshal(%d) = %s, want %s", tc.cents, got, tc.want)
		}
	}
}

// Two decimal places always, so a consumer can parse without special
// casing whole amounts — this is the shape Prisma emits.
func TestAmountMarshalAlwaysTwoPlaces(t *testing.T) {
	got, _ := json.Marshal(AmountOf(FromKES(1200)))
	if string(got) != `"1200.00"` {
		t.Errorf("Marshal(1200) = %s, want \"1200.00\"", got)
	}
}

// Round-tripping through JSON must be lossless in both directions.
func TestAmountRoundTrips(t *testing.T) {
	for _, cents := range []Cents{0, 1, -1, 25050, 999999999, -4520} {
		encoded, err := json.Marshal(AmountOf(cents))
		if err != nil {
			t.Fatalf("Marshal(%d): %v", cents, err)
		}
		var back Amount
		if err := json.Unmarshal(encoded, &back); err != nil {
			t.Fatalf("Unmarshal(%s): %v", encoded, err)
		}
		if back.Cents() != cents {
			t.Errorf("round trip %d -> %s -> %d", cents, encoded, back.Cents())
		}
	}
}

// Struct-level check, since that is how handlers actually use it — and a
// missing field must land as zero rather than erroring.
func TestAmountInStruct(t *testing.T) {
	type req struct {
		CodAmountKes Amount `json:"codAmountKes"`
		Note         string `json:"note"`
	}

	var fromNumber req
	if err := json.Unmarshal([]byte(`{"codAmountKes":2500,"note":"x"}`), &fromNumber); err != nil {
		t.Fatalf("number form: %v", err)
	}
	var fromString req
	if err := json.Unmarshal([]byte(`{"codAmountKes":"2500.00","note":"x"}`), &fromString); err != nil {
		t.Fatalf("string form: %v", err)
	}
	if fromNumber.CodAmountKes != fromString.CodAmountKes {
		t.Errorf("the two wire shapes disagree: %d vs %d",
			fromNumber.CodAmountKes.Cents(), fromString.CodAmountKes.Cents())
	}

	var missing req
	if err := json.Unmarshal([]byte(`{"note":"x"}`), &missing); err != nil {
		t.Fatalf("absent field: %v", err)
	}
	if missing.CodAmountKes.Cents() != 0 {
		t.Errorf("absent field = %d, want 0", missing.CodAmountKes.Cents())
	}
}

func TestAmountKESBridgesToFloatCallers(t *testing.T) {
	var a Amount
	if err := json.Unmarshal([]byte(`"2500.50"`), &a); err != nil {
		t.Fatal(err)
	}
	if got := a.KES(); got != 2500.50 {
		t.Errorf("KES() = %v, want 2500.50", got)
	}
}

func TestAmountString(t *testing.T) {
	if got := AmountOf(25050).String(); got != "250.50" {
		t.Errorf("String() = %q, want \"250.50\"", got)
	}
}

// Scan/Value are what let rows.Scan(&row.AmountField) work. Without
// them that call compiles (Scan takes any) and fails at runtime — so
// these cases are the difference between a caught and an uncaught bug.
func TestAmountScansFromDatabaseTypes(t *testing.T) {
	cases := []struct {
		name string
		src  any
		want Cents
	}{
		{"numeric as string", "1250.50", 125050},
		{"numeric as bytes", []byte("1250.50"), 125050},
		{"null", nil, 0},
		{"float column", 1250.50, 125050},
		{"integer column is whole KES", int64(1250), 125000},
		{"zero", "0.00", 0},
		{"negative", "-45.20", -4520},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var a Amount
			if err := a.Scan(tc.src); err != nil {
				t.Fatalf("Scan(%v) errored: %v", tc.src, err)
			}
			if a.Cents() != tc.want {
				t.Errorf("Scan(%v) = %d cents, want %d", tc.src, a.Cents(), tc.want)
			}
		})
	}
}

func TestAmountScanRejectsUnsupported(t *testing.T) {
	var a Amount
	if err := a.Scan(struct{}{}); err == nil {
		t.Error("Scan(struct{}) = nil error, want an error")
	}
	if err := a.Scan("not-a-number"); err == nil {
		t.Error("Scan(garbage string) = nil error, want an error")
	}
}

func TestAmountValueIsAnExactDecimalString(t *testing.T) {
	v, err := AmountOf(125050).Value()
	if err != nil {
		t.Fatal(err)
	}
	if v != "1250.50" {
		t.Errorf("Value() = %v, want \"1250.50\"", v)
	}
}

func TestAmountScanValueRoundTrip(t *testing.T) {
	for _, cents := range []Cents{0, 1, -1, 125050, 999999999} {
		v, err := AmountOf(cents).Value()
		if err != nil {
			t.Fatal(err)
		}
		var back Amount
		if err := back.Scan(v); err != nil {
			t.Fatal(err)
		}
		if back.Cents() != cents {
			t.Errorf("round trip %d -> %v -> %d", cents, v, back.Cents())
		}
	}
}
