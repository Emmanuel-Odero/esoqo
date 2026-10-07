// Package storage is core-go's object store for images captured in the
// field — today, proof-of-delivery photos (see dbx.DeliverProof).
//
// It deliberately mirrors packages/db/src/storage.ts rule for rule
// rather than inventing a second, weaker policy for the Go side:
//
//  1. The declared MIME type is NEVER trusted. Magic bytes decide.
//  2. The client's filename is NEVER used as a path. Keys are random —
//     no traversal, no collision, no content sniffing from an extension.
//  3. Size is capped before the bytes are written.
//  4. Nothing is served from this package. Reads go through an
//     authorised handler that sets Content-Disposition and nosniff.
//
// The one deliberate difference from the TypeScript side: this accepts
// images only. A courier's phone camera is the sole writer here, and the
// PDF/OOXML branches that exist there are attack surface with no caller
// on this path.
//
// Provider gating matches STORAGE_PROVIDER exactly as storage.ts reads
// it, including the rule that development NEVER touches the real bucket
// even when R2 credentials happen to be present in the environment.
package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/esoqo/core-go/internal/config"
)

// MaxImageBytes — 1MB, matching storage.ts's cap for documents. A
// tighter cap on a field upload path is a smaller denial-of-service
// surface over a courier's mobile data, not just a smaller bill.
const MaxImageBytes = 1 * 1024 * 1024

// Sniff returns the real MIME type of buf, ignoring whatever the client
// claimed. Empty string means "not an image we accept".
//
// Kept to the three formats a camera actually produces. WebP is
// included because modern Android camera/share pipelines emit it and a
// courier shouldn't be blocked by their phone's encoder choice.
func Sniff(buf []byte) string {
	switch {
	case len(buf) >= 8 && bytes.Equal(buf[:8], []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}):
		return "image/png"
	case len(buf) >= 3 && buf[0] == 0xff && buf[1] == 0xd8 && buf[2] == 0xff:
		return "image/jpeg"
	case len(buf) >= 12 && bytes.Equal(buf[:4], []byte("RIFF")) && bytes.Equal(buf[8:12], []byte("WEBP")):
		return "image/webp"
	default:
		return ""
	}
}

func extFor(mime string) string {
	switch mime {
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	default:
		return "jpg"
	}
}

// Key mints a random storage key for [mime]. The date prefix is for
// human browsability of the bucket only — nothing parses it, and
// nothing about it is derived from user input.
func Key(mime string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return fmt.Sprintf("pod/%s/%s.%s",
		time.Now().UTC().Format("2006/01"), hex.EncodeToString(b), extFor(mime)), nil
}

// Store writes bytes somewhere durable and hands back the key.
type Store interface {
	Put(ctx context.Context, key, mime string, body []byte) error
	Get(ctx context.Context, key string) ([]byte, string, error)
}

// New picks a backend the same way storage.ts does: STORAGE_PROVIDER
// wins when set; otherwise development means local disk and anything
// else means R2. Returns a store that always errors if R2 is selected
// without credentials — surfacing a clear message at first use beats
// dialling a half-configured endpoint, which shows up as an opaque TLS
// handshake failure (the exact trap storage.ts documents).
func New(cfg config.Config) Store {
	provider := cfg.StorageProvider
	if provider == "" {
		if config.CurrentAppEnv() == config.AppEnvDevelopment {
			provider = "local"
		} else {
			provider = "r2"
		}
	}
	if provider == "local" {
		dir := cfg.LocalStorageDir
		if dir == "" {
			dir = filepath.Join(".data", "storage")
		}
		return &localStore{dir: dir}
	}
	return &r2Store{cfg: cfg}
}

// ── Local disk (development only) ────────────────────────────────────

type localStore struct{ dir string }

// safeJoin refuses any key that would escape the storage root. Keys are
// always minted by Key() above and can't contain traversal today, but a
// read path that takes a key from a database column is exactly where
// that assumption quietly stops holding.
func (l *localStore) safeJoin(key string) (string, error) {
	clean := filepath.Clean("/" + key)
	full := filepath.Join(l.dir, clean)
	root, err := filepath.Abs(l.dir)
	if err != nil {
		return "", err
	}
	abs, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(abs, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("storage key escapes the storage root")
	}
	return abs, nil
}

func (l *localStore) Put(_ context.Context, key, _ string, body []byte) error {
	path, err := l.safeJoin(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o644)
}

func (l *localStore) Get(_ context.Context, key string) ([]byte, string, error) {
	path, err := l.safeJoin(key)
	if err != nil {
		return nil, "", err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	// Re-sniffed on read rather than trusted from the extension — the
	// same "magic bytes decide" rule that governs the write path, for
	// the same reason.
	return b, Sniff(b), nil
}

// ── Cloudflare R2 ────────────────────────────────────────────────────

type r2Store struct {
	cfg    config.Config
	client *s3.Client
}

func (r *r2Store) ensure(ctx context.Context) (*s3.Client, error) {
	if r.client != nil {
		return r.client, nil
	}
	if r.cfg.R2AccountID == "" {
		return nil, fmt.Errorf("R2 is not configured — set R2_ACCOUNT_ID or use STORAGE_PROVIDER=local")
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion("auto"),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			r.cfg.R2AccessKeyID, r.cfg.R2SecretAccessKey, "")),
	)
	if err != nil {
		return nil, err
	}
	r.client = s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(fmt.Sprintf("https://%s.r2.cloudflarestorage.com", r.cfg.R2AccountID))
		// R2's S3-compatible API rejects the trailer checksums the SDK
		// now sends by default, and the broken stream surfaces as an
		// opaque TLS alert rather than a clean HTTP error — the exact
		// failure storage.ts documents for the JS SDK. Same fix here.
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
		o.UsePathStyle = true
	})
	return r.client, nil
}

func (r *r2Store) bucket() string {
	if r.cfg.R2Bucket != "" {
		return r.cfg.R2Bucket
	}
	return "esoqo"
}

func (r *r2Store) Put(ctx context.Context, key, mime string, body []byte) error {
	client, err := r.ensure(ctx)
	if err != nil {
		return err
	}
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket()),
		Key:         aws.String(key),
		Body:        bytes.NewReader(body),
		ContentType: aws.String(mime),
	})
	return err
}

func (r *r2Store) Get(ctx context.Context, key string) ([]byte, string, error) {
	client, err := r.ensure(ctx)
	if err != nil {
		return nil, "", err
	}
	out, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket()),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, "", err
	}
	defer out.Body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(out.Body); err != nil {
		return nil, "", err
	}
	b := buf.Bytes()
	return b, Sniff(b), nil
}
