// Package handlecode mirrors packages/domain/src/handle-code.ts — the
// free, system-generated Esoqo ID that replaced the old opaque ESK- shape.
//
// It exists here because the Go service mints these too, and a handle
// minted on one side must be indistinguishable from one minted on the
// other: same shape, same mnemonic budget, same CSPRNG draw. Everything
// below is a transliteration rather than a rewrite, and
// handlecode_test.go pins the cases the two implementations share.
package handlecode

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

const (
	// DigitAlphabet closes out every generated handle. Full 0-9, kept
	// byte-for-byte identical to handle-code.ts's DIGIT_ALPHABET — the
	// two mints share one namespace, so a divergence here would change
	// the shape rather than just the provenance.
	DigitAlphabet = "0123456789"

	// HandleDigitLength is how many digits close out every handle.
	HandleDigitLength = 3

	// MaxMnemonicLength caps the letter part so mnemonic+digits never
	// exceeds 11 characters: typeable and SMS-friendly even for a long
	// legal name, and short enough to read back over a phone call.
	MaxMnemonicLength = 8

	// HandleCandidateCount is how many distinct candidates to offer
	// someone at handle-selection time.
	HandleCandidateCount = 3
)

// MinMnemonicLength is the floor the shape check enforces — two letters
// before the digits.
const MinMnemonicLength = 2

var shapeRE = regexp.MustCompile(
	fmt.Sprintf(`^[a-z]{%d,%d}[0-9]{%d}$`, MinMnemonicLength, MaxMnemonicLength, HandleDigitLength))

// CleanName lowercases and drops everything that is not a-z, leaving the
// ASCII-only token every downstream slice is safe to cut. Mirrors
// handle-code.ts's cleanName, including its handling of non-ASCII input
// (diacritics are lowercased first, then discarded).
func CleanName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if r >= 'a' && r <= 'z' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// randomAlphabetString draws length characters from alphabet by rejection
// sampling rather than `%`, so no character is more likely than another.
//
// A CSPRNG failure panics rather than returning an error: crypto/rand does
// not fail outside a genuinely broken host, and continuing with a weaker
// source would mint a guessable payment credential. Failing loudly is the
// safer of the two.
func randomAlphabetString(alphabet string, length int) string {
	if length <= 0 {
		return ""
	}
	max := big.NewInt(int64(len(alphabet)))
	out := make([]byte, 0, length)
	for len(out) < length {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic("handlecode: CSPRNG unavailable: " + err.Error())
		}
		out = append(out, alphabet[v.Int64()])
	}
	return string(out)
}

// randomIndex draws one CSPRNG-backed index into [0, n). Choosing *which*
// name anchors the handle is still credential-shaping, so this never falls
// back to a weaker source.
func randomIndex(n int) int {
	if n <= 1 {
		return 0
	}
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic("handlecode: CSPRNG unavailable: " + err.Error())
	}
	return int(v.Int64())
}

// BuildMnemonic merges a primary name with a secondary one into a single
// readable word capped at MaxMnemonicLength: rather than a long base name
// with random letters tacked on, both names contribute a real, front-
// anchored chunk of themselves, biased to keep the primary intact.
// "john" + "mutuku" -> "johnmutu". With only one usable name, that name
// alone is clipped to fit.
func BuildMnemonic(primary, secondary string) string {
	if secondary == "" {
		return clip(primary, MaxMnemonicLength)
	}
	minSecondary := len(secondary)
	if minSecondary > 2 {
		minSecondary = 2
	}
	primaryBudget := MaxMnemonicLength - minSecondary
	if primaryBudget < 1 {
		primaryBudget = 1
	}
	primaryPart := clip(primary, primaryBudget)
	secondaryPart := clip(secondary, MaxMnemonicLength-len(primaryPart))
	return primaryPart + secondaryPart
}

func clip(s string, n int) string {
	if n < 0 {
		n = 0
	}
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// GenerateSystemHandle builds a candidate free Esoqo ID from 1-3 official
// names: one name is drawn at random as the primary, a second distinct
// name is merged into it via BuildMnemonic, and HandleDigitLength digits
// are appended. ["John","Mutuku","Kamau"] might yield "johnmutu482".
//
// Like mintEsoqoCode before it, this is a *candidate* — it is not checked
// against the database. The caller owns the unique constraint and retry
// (see allocateEsoqoHandle in packages/db/src/dal/payment-id.ts).
//
// Returns an error, never panics, when no name survives cleaning: callers
// are request handlers on the sign-in path, where a party with no usable
// name is a data defect to report, not a reason to take the process down.
func GenerateSystemHandle(names []string) (string, error) {
	cleaned := make([]string, 0, len(names))
	for _, n := range names {
		if c := CleanName(n); c != "" {
			cleaned = append(cleaned, c)
		}
	}
	if len(cleaned) == 0 {
		return "", errors.New("handlecode: GenerateSystemHandle needs at least one name")
	}

	primaryIndex := randomIndex(len(cleaned))
	others := make([]string, 0, len(cleaned)-1)
	for i, n := range cleaned {
		if i != primaryIndex {
			others = append(others, n)
		}
	}
	secondary := ""
	if len(others) > 0 {
		secondary = others[randomIndex(len(others))]
	}
	return BuildMnemonic(cleaned[primaryIndex], secondary) +
		randomAlphabetString(DigitAlphabet, HandleDigitLength), nil
}

// PersonHandleCandidates returns the handle mnemonics a person's names
// yield, most specific first.
//
// GenerateSystemHandle picks the primary and secondary name at random,
// which is right when a human is choosing from the options but wrong for the
// automatic mint: every retry could pick the same saturated mnemonic, so a
// crowded name pair would burn the whole budget while the other orderings
// ("kamaujoh" when "johnkam" is taken) sat unused. Enumerating them makes
// the mint escalate instead of retrying blind.
//
// The merged pair is tried before the bare names because a merged mnemonic
// is the more identifying one — "johnkam" says more than "john" — and a
// bare name is a graceful last resort once the pair space is full.
func PersonHandleCandidates(names []string) []string {
	var cleaned []string
	seen := map[string]bool{}
	for _, n := range names {
		c := CleanName(n)
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		cleaned = append(cleaned, c)
	}
	if len(cleaned) == 0 {
		return nil
	}

	var out []string
	add := func(s string) {
		s = clip(s, MaxMnemonicLength)
		if len(s) < MinMnemonicLength {
			return
		}
		for _, existing := range out {
			if existing == s {
				return
			}
		}
		out = append(out, s)
	}
	for i, primary := range cleaned {
		for j, secondary := range cleaned {
			if i != j {
				add(BuildMnemonic(primary, secondary))
			}
		}
	}
	for _, name := range cleaned {
		add(name)
	}
	return out
}

// MintHandle walks a list of pre-derived mnemonics, re-rolling each one's
// digit tail until done reports the insert landed. Returns the handle and
// true on success, or "", false once every candidate is exhausted — the
// caller surfaces the collision.
//
// Both mints funnel through here so the retry budget and escalation order
// are decided in exactly one place.
func MintHandle(candidates []string, done func(candidate string) bool) (string, bool) {
	for _, mnemonic := range candidates {
		for attempt := 0; attempt < digitsPerMnemonic; attempt++ {
			candidate := mnemonic + RandomHandleDigits()
			if done(candidate) {
				return candidate, true
			}
		}
	}
	return "", false
}

// digitsPerMnemonic is how many distinct three-digit tails each mnemonic is
// given before the mint moves on to the next one.
const digitsPerMnemonic = 8

// GenerateHandleCandidates offers up to count distinct handle candidates
// for someone to choose from at registration — the "show three options,
// they pick one" step. Candidates are plain GenerateSystemHandle calls,
// de-duplicated by re-rolling; none are reserved or checked against the
// database yet. Returns fewer than count (possibly none) if the name set
// cannot support that many distinct shapes — the caller offers what it got.
func GenerateHandleCandidates(names []string, count int) []string {
	if count <= 0 {
		return nil
	}
	seen := make(map[string]struct{}, count)
	out := make([]string, 0, count)
	maxAttempts := count * 20
	for attempt := 0; len(out) < count && attempt < maxAttempts; attempt++ {
		c, err := GenerateSystemHandle(names)
		if err != nil {
			return nil
		}
		if _, dup := seen[c]; dup {
			continue
		}
		seen[c] = struct{}{}
		out = append(out, c)
	}
	return out
}

// Canonicalize normalises user input to the stored form. Handles are minted
// lower-case, so this lower-cases and trims — deliberately not an uppercase
// fold, which is what used to make every handle miss in Go.
func Canonicalize(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

// orgStopwords are the function words dropped before a group or business
// name is turned into a mnemonic. "Mchama wa Wananchi" reads as
// "mchamawanan..." if the "wa" is left in to be merged with its neighbour,
// and Swahili function words cluster exactly where an English reader's
// would, so they have to come out before any clipping happens. Only
// function words are listed — never a noun, however generic, because
// "society" or "group" is often the most identifying word an org has.
var orgStopwords = map[string]bool{
	"wa": true, "za": true, "ya": true, "la": true, "na": true,
	"kwa": true, "cha": true, "vya": true, "kama": true, "au": true,
	"the": true, "of": true, "and": true, "for": true, "a": true,
	"an": true, "in": true, "on": true, "at": true, "to": true,
}

// GenerateOrgHandle builds a handle from an organisation's name, which is a
// phrase rather than a person's forename/surname and so cannot go straight
// through GenerateSystemHandle's two-name merge.
//
// Convenience wrapper over OrgMnemonic + RandomHandleDigits for callers with
// no retry loop. Anything that must survive a unique violation should walk
// OrgMnemonicCandidates and re-roll digits against each — see
// insertOrgPaymentID.
func GenerateOrgHandle(officialName, knownAs string) (string, error) {
	mnemonic, err := OrgMnemonic(officialName, knownAs)
	if err != nil {
		return "", err
	}
	return mnemonic + RandomHandleDigits(), nil
}

// RandomHandleDigits returns a fresh HandleDigitLength-digit tail. Callers
// retrying on a handle collision re-roll through here so a name-derived
// mnemonic stays stable while the collision-prone part varies.
func RandomHandleDigits() string {
	return randomAlphabetString(DigitAlphabet, HandleDigitLength)
}

// OrgMnemonic returns the most specific handle mnemonic an organisation's
// name yields — see OrgMnemonicCandidates for the ordering.
func OrgMnemonic(officialName, knownAs string) (string, error) {
	candidates := OrgMnemonicCandidates(officialName, knownAs)
	if len(candidates) == 0 {
		return "", errors.New("handlecode: OrgMnemonic needs a usable organisation name")
	}
	return candidates[0], nil
}

// OrgMnemonicCandidates returns the handle mnemonics an organisation's name
// yields, in the order they should be tried.
//
// A group name is a phrase, and GenerateSystemHandle's two-name merge cannot
// take one: it clips the second name to two letters, and "Wananchi"[:2] is
// "wa" — so "Mchama wa Wananchi" minted "mchamawa482", a handle containing
// the very stopword the merge was supposed to drop. Merging two words
// necessarily cuts one of them mid-token, so this never does that up front.
//
// Instead each token is offered whole first, in order, and only the unused
// 1,000 three-digit tails of those are tried before any token is cut. That
// ordering also handles the case where the leading word is simply not
// distinctive enough: Kenyan group names lead with "chama" or "jamii" often
// enough that a thousand numeric suffixes would not cover them, so a
// saturated "chama###" falls through to the next token ("wananchi") instead
// of failing the mint or bloating the handle into word-soup.
//
// knownAs is consulted only when officialName yields nothing usable, since
// it is the less formal of the two.
func OrgMnemonicCandidates(officialName, knownAs string) []string {
	for _, name := range []string{officialName, knownAs} {
		if candidates := orgMnemonicCandidatesFrom(name); len(candidates) > 0 {
			return candidates
		}
	}
	return nil
}

func orgMnemonicCandidatesFrom(name string) []string {
	// Split on whitespace and punctuation before cleaning: cleaning first
	// would glue "Mchama wa Wananchi" into one token and leave the
	// stopword filter with nothing to recognise.
	raw := strings.FieldsFunc(strings.ToLower(name), func(r rune) bool { return !isASCIILetter(r) })
	if len(raw) == 0 {
		return nil
	}
	meaningful := make([]string, 0, len(raw))
	for _, f := range raw {
		if !orgStopwords[f] {
			meaningful = append(meaningful, f)
		}
	}
	if len(meaningful) == 0 {
		// A name made entirely of function words ("Wa Wa Wa") — keep the
		// original tokens rather than refusing to mint.
		meaningful = raw
	}

	var out []string
	add := func(s string) {
		s = clip(s, MaxMnemonicLength)
		if len(s) < MinMnemonicLength {
			return
		}
		for _, existing := range out {
			if existing == s {
				return
			}
		}
		out = append(out, s)
	}
	for _, token := range meaningful {
		add(token)
	}
	if len(meaningful) > 1 {
		add(strings.Join(meaningful[:2], ""))
		add(strings.Join(meaningful, ""))
	}
	return out
}

func isASCIILetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// IsSystemHandleShape reports whether raw is shaped like a free
// system-generated handle — lowercase letters then HandleDigitLength
// digits. Shape only, same caveat as isEsoqoIdShape: this answers "could
// this be one", the database answers "is this one".
func IsSystemHandleShape(raw string) bool {
	return shapeRE.MatchString(strings.ToLower(strings.TrimSpace(raw)))
}
