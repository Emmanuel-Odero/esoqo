package authsvc

import (
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"
)

// Minimal PHC string format ($argon2id$v=19$m=...,t=...,p=...$salt$hash)
// codec — enough to interop with @node-rs/argon2's output (the TS side's
// hasher), including DummyPinHash above which was generated there.

func encodePHC(salt, hash []byte) string {
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemoryKiB, argonIterations, argonParallel, b64.EncodeToString(salt), b64.EncodeToString(hash))
}

func decodePHC(encoded string) (salt, hash []byte, err error) {
	parts := strings.Split(encoded, "$")
	// ["", "argon2id", "v=19", "m=...,t=...,p=...", "<salt>", "<hash>"]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return nil, nil, fmt.Errorf("not an argon2id PHC hash")
	}
	b64 := base64.RawStdEncoding
	salt, err = b64.DecodeString(parts[4])
	if err != nil {
		return nil, nil, err
	}
	hash, err = b64.DecodeString(parts[5])
	if err != nil {
		return nil, nil, err
	}
	return salt, hash, nil
}

func constantTimeEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare(a, b) == 1
}
