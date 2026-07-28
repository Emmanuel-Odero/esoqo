# services/credential · TypeScript

**Status: not started. Phase 3.**

SD-JWT VC issuance, OID4VCI, verification and revocation. TypeScript for
the library ecosystem (ADR-0004).

Standards, per the DPI-readiness document:
- W3C Verifiable Credentials Data Model 2.0 (Recommendation, 2025)
- SD-JWT VC — accept both `vc+sd-jwt` and `dc+sd-jwt` during transition
- OpenID for Verifiable Credential Issuance 1.0 (Final, Sept 2025)

Signing keys never leave the KMS. This service is the only caller, its
access is logged, and key custody is a human decision — not an AI one.
