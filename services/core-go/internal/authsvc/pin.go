package authsvc

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"regexp"

	"golang.org/x/crypto/argon2"
)

// Argon2id params, matching packages/auth/src/pin.ts's OWASP-guidance
// settings exactly: 19 MiB, 2 iterations, parallelism 1.
const (
	argonMemoryKiB  = 19_456
	argonIterations = 2
	argonParallel   = 1
	argonKeyLen     = 32
	argonSaltLen    = 16
)

var pinShapeRe = regexp.MustCompile(`^\d{4,6}$`)

// DummyPinHash is a pre-computed, valid Argon2id hash of an unrelated PIN
// — nobody's real credential. Verify against this when a lookup (by
// phone) comes back empty, so "no such account" and "wrong PIN" take the
// same code path and the same wall-clock time. This is the exact hash
// packages/auth/src/pin.ts ships, kept identical on purpose.
const DummyPinHash = "$argon2id$v=19$m=19456,t=2,p=1$dVG7zaa+zCpEHmx40p8mrg$qrCW9sFDblyvsFW58O4LlQ07vfoVltVcJY5cQ0YzrDE"

func GenerateTempPin() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(900_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d", n.Int64()+100_000), nil
}

// HashPin returns a PHC-formatted Argon2id hash string, self-describing
// so VerifyPin needs no external record of the parameters used.
func HashPin(pin string) (string, error) {
	if !pinShapeRe.MatchString(pin) {
		return "", errors.New("PIN must be 4 to 6 digits")
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(pin), salt, argonIterations, argonMemoryKiB, argonParallel, argonKeyLen)
	return encodePHC(salt, hash), nil
}

// VerifyPin is constant-time (argon2.IDKey + subtle.ConstantTimeCompare)
// and never returns an error — a malformed stored hash just verifies
// false, same contract as the TS version.
func VerifyPin(pin, stored string) bool {
	salt, hash, err := decodePHC(stored)
	if err != nil {
		return false
	}
	candidate := argon2.IDKey([]byte(pin), salt, argonIterations, argonMemoryKiB, argonParallel, uint32(len(hash)))
	return constantTimeEqual(candidate, hash)
}

// IsWeakPin refuses the PINs that show up in every breach corpus, plus
// any all-identical/ascending/descending run — same deny-list as
// packages/auth/src/pin.ts.
func IsWeakPin(pin string) bool {
	weak := map[string]bool{
		"0000": true, "1111": true, "2222": true, "3333": true, "4444": true,
		"5555": true, "6666": true, "7777": true, "8888": true, "9999": true,
		"1234": true, "4321": true, "1212": true, "2580": true, "0852": true,
		"1379": true, "1122": true, "6969": true, "0123": true,
	}
	if weak[pin] {
		return true
	}
	allSame := true
	for i := 1; i < len(pin); i++ {
		if pin[i] != pin[0] {
			allSame = false
			break
		}
	}
	if allSame {
		return true
	}
	asc, desc := true, true
	for i := 1; i < len(pin); i++ {
		if pin[i]-pin[i-1] != 1 {
			asc = false
		}
		if pin[i-1]-pin[i] != 1 {
			desc = false
		}
	}
	return asc || desc
}
