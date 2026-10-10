// services/ci-webhook — the in-cluster replacement for GitHub Actions,
// which is permanently broken server-side for this repo (every push
// routes to a dead, orphaned workflow_id; GitHub's own backend never
// creates a job — see docs/deployment/README.md's CI/CD section). This
// listens for GitHub's plain repository webhooks (a separate, working
// subsystem from Actions) and, on a push to its one configured branch,
// creates the deployer Job that builds, migrates and rolls out that
// commit.
//
// One instance of this runs per namespace (esoqo-preview,
// esoqo-production), each with its own ServiceAccount scoped to only
// its own namespace — a bug in preview's pipeline cannot touch
// production, by RBAC, not by convention.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	resource "k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Config, entirely from the environment — this image is identical
// between preview and production; only the env differs, same as every
// other workload in deploy/k8s/base.
type config struct {
	Namespace     string // which namespace this instance is allowed to touch (its own)
	Branch        string // "preview" or "production" — the only ref this instance reacts to
	WebhookSecret []byte // GitHub's HMAC signing secret for this hook
	DeployerImage string // image reference for the orchestrator Job (section 3 of the plan)
	GitRepoURL    string // https://github.com/Emmanuel-Odero/esoqo.git
	ListenAddr    string
}

func loadConfig() (config, error) {
	c := config{
		Namespace:     os.Getenv("NAMESPACE"),
		Branch:        os.Getenv("TARGET_BRANCH"),
		DeployerImage: os.Getenv("DEPLOYER_IMAGE"),
		GitRepoURL:    os.Getenv("GIT_REPO_URL"),
		ListenAddr:    envOr("LISTEN_ADDR", ":8080"),
	}
	secret := os.Getenv("WEBHOOK_SECRET")
	if c.Namespace == "" || c.Branch == "" || c.DeployerImage == "" || c.GitRepoURL == "" || secret == "" {
		return c, errors.New("NAMESPACE, TARGET_BRANCH, DEPLOYER_IMAGE, GIT_REPO_URL and WEBHOOK_SECRET are all required")
	}
	c.WebhookSecret = []byte(secret)
	return c, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// pushPayload — only the fields we actually branch on. GitHub's push
// payload has dozens more we don't care about.
type pushPayload struct {
	Ref        string `json:"ref"`
	After      string `json:"after"` // the commit SHA to build
	HeadCommit *struct {
		Message string `json:"message"`
		Author  struct {
			Name  string `json:"name"`
			Email string `json:"email"`
		} `json:"author"`
	} `json:"head_commit"`
}

// deployerEmail is the identity orchestrate.sh commits its overlay
// tag-bump with. A deploy of commit A ends by the deployer pushing a
// "deploy(...): A" commit B back to the branch, which is itself a push
// event — without this guard the webhook would start a fresh pipeline
// for B, and B's deploy would push C, forever. Skipping our own pushes
// (and anything explicitly marked) is what makes the loop terminate.
const deployerEmail = "ci@esoqo.com"

func isSelfDeploy(p pushPayload) bool {
	if p.HeadCommit == nil {
		return false
	}
	if strings.EqualFold(p.HeadCommit.Author.Email, deployerEmail) {
		return true
	}
	msg := p.HeadCommit.Message
	return strings.Contains(msg, "[skip ci]") || strings.Contains(msg, "[skip deploy]")
}

type server struct {
	cfg config
	k8s kubernetes.Interface
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	restCfg, err := rest.InClusterConfig()
	if err != nil {
		log.Fatalf("not running in-cluster, no ServiceAccount token available: %v", err)
	}
	clientset, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		log.Fatalf("building k8s client: %v", err)
	}

	s := &server{cfg: cfg, k8s: clientset}

	mux := http.NewServeMux()
	mux.HandleFunc("/hooks/deploy", s.handleWebhook)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	log.Printf("ci-webhook listening on %s — namespace=%s branch=%s", cfg.ListenAddr, cfg.Namespace, cfg.Branch)
	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatal(err)
	}
}

func (s *server) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20)) // 5MB cap, pushes carry commit lists but never anywhere near this
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}

	if !validSignature(s.cfg.WebhookSecret, r.Header.Get("X-Hub-Signature-256"), body) {
		log.Printf("rejected webhook: bad signature")
		http.Error(w, "bad signature", http.StatusUnauthorized)
		return
	}

	if r.Header.Get("X-GitHub-Event") != "push" {
		w.WriteHeader(http.StatusOK) // not an error — just nothing we react to
		return
	}

	var p pushPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, "bad payload", http.StatusBadRequest)
		return
	}

	wantRef := "refs/heads/" + s.cfg.Branch
	if p.Ref != wantRef || p.After == "" {
		w.WriteHeader(http.StatusOK) // different branch — not ours
		return
	}

	if isSelfDeploy(p) {
		log.Printf("ignoring deployer's own push for %s (would loop)", p.After)
		w.WriteHeader(http.StatusOK)
		return
	}

	sha := p.After
	shortSHA := sha
	if len(shortSHA) > 12 {
		shortSHA = shortSHA[:12]
	}

	if err := s.createDeployJob(r.Context(), sha, shortSHA); err != nil {
		log.Printf("could not create deploy job for %s: %v", shortSHA, err)
		http.Error(w, "could not start deploy", http.StatusInternalServerError)
		return
	}

	log.Printf("deploy job created for %s (%s)", shortSHA, s.cfg.Branch)
	w.WriteHeader(http.StatusAccepted)
}

// validSignature checks GitHub's X-Hub-Signature-256 header
// ("sha256=<hex>") against an HMAC-SHA256 of the raw body. Constant-time
// compare — this is exactly the kind of check a timing side-channel can
// erode if done with a plain ==.
func validSignature(secret []byte, header string, body []byte) bool {
	const prefix = "sha256="
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	got, err := hex.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(body)
	want := mac.Sum(nil)
	return subtle.ConstantTimeCompare(got, want) == 1
}

// createDeployJob creates the one-shot orchestrator Job for this commit.
// The Job's name is deterministic from the short SHA, so a duplicate
// webhook delivery for the same push (GitHub retries on a slow 2xx)
// collides on an "already exists" error rather than starting a second
// concurrent pipeline for the same commit.
func (s *server) createDeployJob(ctx context.Context, sha, shortSHA string) error {
	backoff := int32(0)  // a failed deploy should surface immediately, not silently retry and maybe apply only half-done
	ttl := int32(604800) // 1 week — matches migrate-job.yaml's own retention, doubles as deploy history

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "esoqo-deploy-" + shortSHA,
			Namespace: s.cfg.Namespace,
			Labels: map[string]string{
				"app.kubernetes.io/name":      "esoqo-deployer",
				"app.kubernetes.io/component": "ci",
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app.kubernetes.io/name":      "esoqo-deployer",
						"app.kubernetes.io/component": "ci",
					},
				},
				Spec: corev1.PodSpec{
					RestartPolicy:      corev1.RestartPolicyNever,
					ServiceAccountName: "esoqo-deployer",
					Containers: []corev1.Container{
						{
							Name:            "deployer",
							Image:           s.cfg.DeployerImage,
							ImagePullPolicy: corev1.PullAlways, // :bootstrap is a mutable tag; always take the current push
							Env: []corev1.EnvVar{
								{Name: "GIT_SHA", Value: sha},
								{Name: "GIT_SHA_SHORT", Value: shortSHA},
								{Name: "GIT_REPO_URL", Value: s.cfg.GitRepoURL},
								{Name: "TARGET_BRANCH", Value: s.cfg.Branch},
								{Name: "NAMESPACE", Value: s.cfg.Namespace},
								{Name: "GIT_READ_TOKEN", ValueFrom: secretKeyRef("ci-git-credentials", "GIT_READ_TOKEN")},
								{Name: "GIT_WRITE_TOKEN", ValueFrom: secretKeyRef("ci-git-credentials", "GIT_WRITE_TOKEN")},
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("100m"),
									corev1.ResourceMemory: resource.MustParse("256Mi"),
								},
							},
						},
					},
				},
			},
		},
	}

	_, err := s.k8s.BatchV1().Jobs(s.cfg.Namespace).Create(ctx, job, metav1.CreateOptions{})
	if apierrors.IsAlreadyExists(err) {
		return nil // duplicate delivery for a commit we're already deploying — not an error
	}
	return err
}

func secretKeyRef(name, key string) *corev1.EnvVarSource {
	return &corev1.EnvVarSource{
		SecretKeyRef: &corev1.SecretKeySelector{
			LocalObjectReference: corev1.LocalObjectReference{Name: name},
			Key:                  key,
		},
	}
}
