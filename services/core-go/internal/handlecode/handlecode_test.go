package handlecode

import (
	"regexp"
	"testing"
)

// These pin the cases shared with packages/domain/src/handle-code.test.ts.
// A handle minted by either side must be indistinguishable from the other,
// so anything that can drift — the shape, the mnemonic budget, the digit
// tail — is asserted here rather than eyeballed.

var digitsRE = regexp.MustCompile(`^[0-9]+$`)
var alphaNumRE = regexp.MustCompile(`^[a-z0-9]+$`)
var soloRE = regexp.MustCompile(`^[a-z]+[0-9]{3}$`)

func TestBuildMnemonic(t *testing.T) {
	tests := []struct {
		name               string
		primary, secondary string
		want               string
	}{
		{"merges both names, primary front-anchored", "john", "mutuku", "johnmutu"},
		{"no secondary clips the primary alone", "solo", "", "solo"},
		{"long primary yields at least 2 letters of the secondary", "christopher", "wanjiku", "christwa"},
		{"both sides respect the 8-letter budget", "mutukukimani", "kamau", "mutukuka"},
		{"short secondary fills the whole remaining budget", "john", "doe", "johndoe"},
		{"empty primary keeps the secondary within budget", "", "kamau", "kamau"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := BuildMnemonic(tc.primary, tc.secondary); got != tc.want {
				t.Fatalf("BuildMnemonic(%q, %q) = %q, want %q", tc.primary, tc.secondary, got, tc.want)
			}
			if got := BuildMnemonic(tc.primary, tc.secondary); len(got) > MaxMnemonicLength {
				t.Fatalf("mnemonic %q exceeds %d letters", got, MaxMnemonicLength)
			}
		})
	}
}

func TestCleanName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"John", "john"},
		{"JOHN", "john"},
		{"Muthoni", "muthoni"},
		{"Anne-Marie", "annemarie"},
		{"O'Brien", "obrien"},
		{"  spaced  ", "spaced"},
		{"J0hn", "jhn"},
		{"Émile", "mile"},
		{"---", ""},
	}
	for _, tc := range tests {
		if got := CleanName(tc.in); got != tc.want {
			t.Errorf("CleanName(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestGenerateSystemHandleShape(t *testing.T) {
	handle := mustHandle(t, "John", "Mutuku", "Kamau")

	digits := handle[len(handle)-HandleDigitLength:]
	if !digitsRE.MatchString(digits) {
		t.Errorf("handle %q does not end in %d digits", handle, HandleDigitLength)
	}
	if !alphaNumRE.MatchString(handle) {
		t.Errorf("handle %q is not lowercase alphanumeric", handle)
	}
	if !IsSystemHandleShape(handle) {
		t.Errorf("generated handle %q fails its own shape check", handle)
	}
}

func TestGenerateSystemHandleSingleName(t *testing.T) {
	if h := mustHandle(t, "Solo"); !soloRE.MatchString(h) {
		t.Errorf("single-name handle %q does not match ^[a-z]+[0-9]{3}$", h)
	}
}

func TestGenerateSystemHandleRejectsNoUsableNames(t *testing.T) {
	for _, names := range [][]string{nil, {}, {"", "   "}, {"---"}} {
		if h, err := GenerateSystemHandle(names); err == nil {
			t.Errorf("GenerateSystemHandle(%q) = %q, want an error", names, h)
		}
	}
}

func TestGenerateSystemHandleWidth(t *testing.T) {
	names := []string{"Wanjiru", "Nyambura", "Wambui"}
	for i := 0; i < 200; i++ {
		if h := mustHandle(t, names...); len(h) > MaxMnemonicLength+HandleDigitLength {
			t.Fatalf("handle %q is %d chars, want at most %d", h, len(h), MaxMnemonicLength+HandleDigitLength)
		}
	}
	if h := mustHandle(t, "Nyambura", "Wanjikuruthi"); len(h) > MaxMnemonicLength+HandleDigitLength {
		t.Fatalf("long legal name produced %q (%d chars)", h, len(h))
	}
}

// Not a uniqueness guarantee — that is the unique index's job. This only
// confirms the generator is not degenerately narrow, which would make
// every retry loop in the allocators burn its attempts for nothing.
func TestGenerateSystemHandleIsNotDegeneratelyNarrow(t *testing.T) {
	seen := map[string]struct{}{}
	for i := 0; i < 500; i++ {
		seen[mustHandle(t, "John", "Mutuku", "Kamau")] = struct{}{}
	}
	if len(seen) <= 400 {
		t.Fatalf("500 draws produced only %d distinct handles", len(seen))
	}
}

func TestGenerateHandleCandidates(t *testing.T) {
	candidates := GenerateHandleCandidates([]string{"John", "Mutuku", "Kamau"}, HandleCandidateCount)
	if len(candidates) != HandleCandidateCount {
		t.Fatalf("got %d candidates, want %d", len(candidates), HandleCandidateCount)
	}
	seen := map[string]struct{}{}
	for _, c := range candidates {
		if !IsSystemHandleShape(c) {
			t.Errorf("candidate %q is not handle-shaped", c)
		}
		if _, dup := seen[c]; dup {
			t.Errorf("candidate %q repeated", c)
		}
		seen[c] = struct{}{}
	}

	if got := GenerateHandleCandidates([]string{"Solo"}, 1); len(got) != 1 {
		t.Fatalf("requested 1 candidate, got %d", len(got))
	}
	if got := GenerateHandleCandidates([]string{"Solo"}, 0); got != nil {
		t.Fatalf("requested 0 candidates, got %v", got)
	}
}

func TestIsSystemHandleShape(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{mustHandle(t, "John", "Mutuku", "Kamau"), true},
		{"mutuku482", true},
		{"Mutuku482", true},
		{"  mutuku482  ", true},
		{"mutukuka482", true},
		{"a1", false},
		{"mutuku-482", false},
		{"mutuku", false},
		{"mutuku4821", false},
		{"mutuku4821a", false},
		{"", false},
		{"9mutuku482", false},
	}
	for _, tc := range tests {
		if got := IsSystemHandleShape(tc.in); got != tc.want {
			t.Errorf("IsSystemHandleShape(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func mustHandle(t *testing.T, names ...string) string {
	t.Helper()
	h, err := GenerateSystemHandle(names)
	if err != nil {
		t.Fatalf("GenerateSystemHandle(%q): %v", names, err)
	}
	return h
}

func TestCanonicalize(t *testing.T) {
	for in, want := range map[string]string{
		"mutukuka482":   "mutukuka482",
		"  MUTUKUKA482": "mutukuka482",
		"John482":       "john482",
	} {
		if got := Canonicalize(in); got != want {
			t.Errorf("Canonicalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOrgMnemonicCandidates(t *testing.T) {
	tests := []struct {
		name, official, knownAs string
		wantFirst               string
	}{
		{"drops the swahili connector", "Mchama wa Wananchi", "", "mchama"},
		{"drops english articles", "The Green Market", "", "green"},
		{"keeps a known acronym intact rather than padding it", "KCB 2024 Savings", "", "kcb"},
		{"long lead stands alone", "Baraka Farmers Cooperative Society", "", "baraka"},
		{"digits split into their own tokens and drop out", "KCB 2024 Savings", "", "kcb"},
		{"case and spacing are irrelevant", "  mCHAMA   wa  wananchi ", "", "mchama"},
		{"falls back to knownAs when officialName is unusable", "---", "Chama Yetu", "chama"},
		{"an all-stopword name still mints", "Wa Wa Wa", "", "wa"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := OrgMnemonicCandidates(tc.official, tc.knownAs)
			if len(got) == 0 {
				t.Fatalf("OrgMnemonicCandidates(%q, %q) produced nothing", tc.official, tc.knownAs)
			}
			if got[0] != tc.wantFirst {
				t.Fatalf("first candidate = %q, want %q (all: %v)", got[0], tc.wantFirst, got)
			}
			for _, m := range got {
				if len(m) > MaxMnemonicLength || len(m) < MinMnemonicLength {
					t.Fatalf("candidate %q is outside [%d,%d]", m, MinMnemonicLength, MaxMnemonicLength)
				}
			}
		})
	}
}

// A saturated generic lead has to be able to become more specific, or a
// thousand "chama###" handles would exhaust and every later group of that
// name would fail to mint.
func TestOrgMnemonicCandidatesEscalatePastAGenericLead(t *testing.T) {
	got := OrgMnemonicCandidates("Chama wa Wananchi", "")
	if len(got) < 2 {
		t.Fatalf("want a fallback candidate, got %v", got)
	}
	if got[0] != "chama" || got[1] != "wananchi" {
		t.Fatalf("want [chama wananchi] escalation, got %v", got)
	}
}

// The specific defect this design exists to prevent: the two-name merge
// clips a secondary name to two letters, and "Wananchi"[:2] is "wa", so
// "Mchama wa Wananchi" used to mint a handle containing the stopword it
// was supposed to drop. The clipped combination may still appear, but only
// after every whole-token candidate has been tried.
func TestOrgMnemonicDoesNotLeadWithTheStopwordLeak(t *testing.T) {
	got := OrgMnemonicCandidates("Mchama wa Wananchi", "")
	if got[0] == "mchamawa" {
		t.Fatal("first candidate regressed to the mchamawa stopword leak")
	}
}

func TestOrgMnemonicRejectsUnusableNames(t *testing.T) {
	for _, tc := range [][2]string{{"", ""}, {"   ", "  "}, {"12345", "!!!"}, {"-", "..."}} {
		if got := OrgMnemonicCandidates(tc[0], tc[1]); len(got) != 0 {
			t.Errorf("OrgMnemonicCandidates(%q, %q) = %v, want none", tc[0], tc[1], got)
		}
	}
}

func TestGenerateOrgHandleShapeAndStability(t *testing.T) {
	h, err := GenerateOrgHandle("Mchama wa Wananchi", "")
	if err != nil {
		t.Fatal(err)
	}
	if !IsSystemHandleShape(h) {
		t.Fatalf("org handle %q fails the shape check", h)
	}
	// Same name must yield the same mnemonic every time, or a printed
	// stand would stop matching after the digits re-rolled.
	first, _ := OrgMnemonic("Mchama wa Wananchi", "")
	for i := 0; i < 20; i++ {
		again, _ := OrgMnemonic("Mchama wa Wananchi", "")
		if again != first {
			t.Fatalf("OrgMnemonic is not deterministic: %q then %q", first, again)
		}
	}
}

func TestPersonHandleCandidates(t *testing.T) {
	tests := []struct {
		name      string
		in        []string
		wantFirst string
	}{
		{"merged pair leads, because it is the more identifying", []string{"John", "Kamau"}, "johnkama"},
		{"reversed ordering is a candidate too", []string{"Kamau", "John"}, "kamaujoh"},
		{"middle name participates", []string{"Wanjiru", "Nyambura", "Wambui"}, ""},
		{"a single name still mints", []string{"Solo"}, "solo"},
		{"case-insensitive and de-duplicated", []string{"john", "JOHN", "Kamau"}, "johnkama"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := PersonHandleCandidates(tc.in)
			if len(got) == 0 {
				t.Fatalf("PersonHandleCandidates(%q) produced nothing", tc.in)
			}
			if tc.wantFirst != "" && got[0] != tc.wantFirst {
				t.Fatalf("first candidate = %q, want %q (all: %v)", got[0], tc.wantFirst, got)
			}
			for _, m := range got {
				if len(m) > MaxMnemonicLength || len(m) < MinMnemonicLength {
					t.Fatalf("candidate %q is outside [%d,%d]", m, MinMnemonicLength, MaxMnemonicLength)
				}
			}
		})
	}
}

// The automatic mint used to pick its mnemonic at random on every retry, so
// a saturated pair could burn the whole budget re-rolling one name while
// the other ordering sat free.
func TestPersonHandleCandidatesEscalate(t *testing.T) {
	got := PersonHandleCandidates([]string{"John", "Kamau"})
	if len(got) < 2 || got[0] != "johnkama" || got[1] != "kamaujoh" {
		t.Fatalf("want [johnkama kamaujoh] escalation, got %v", got)
	}
}

func TestPersonHandleCandidatesRejectsUnusableNames(t *testing.T) {
	for _, in := range [][]string{nil, {}, {""}, {"   "}, {"---"}} {
		if got := PersonHandleCandidates(in); len(got) != 0 {
			t.Errorf("PersonHandleCandidates(%q) = %v, want none", in, got)
		}
	}
}

func TestMintHandleEscalatesThenGivesUp(t *testing.T) {
	candidates := []string{"chama", "wananchi"}
	tried := []string{}
	got, ok := MintHandle(candidates, func(c string) bool {
		tried = append(tried, c)
		return false
	})
	if ok || got != "" {
		t.Fatalf("MintHandle claimed success: %q", got)
	}
	// Every candidate must be tried, and each gets digitsPerMnemonic tails.
	if len(tried) != digitsPerMnemonic*len(candidates) {
		t.Fatalf("tried %d candidates, want %d", len(tried), digitsPerMnemonic*len(candidates))
	}
	if tried[0][:5] != "chama" || tried[digitsPerMnemonic][:8] != "wananchi" {
		t.Fatalf("escalation order wrong: first=%q then=%q", tried[0], tried[digitsPerMnemonic])
	}

	// Stopping as soon as one lands is the whole contract.
	n := 0
	got, ok = MintHandle(candidates, func(string) bool { n++; return n == 3 })
	if !ok || n != 3 || got[:5] != "chama" {
		t.Fatalf("MintHandle: got %q ok=%v after %d tries", got, ok, n)
	}
}

func TestMintHandleWithNoCandidates(t *testing.T) {
	if got, ok := MintHandle(nil, func(string) bool { t.Fatal("must not attempt"); return true }); ok || got != "" {
		t.Fatalf("MintHandle(nil) = %q, %v", got, ok)
	}
}
