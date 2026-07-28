# infra

**Status: not started.**

Terraform for the core plane. Target per ADR-0001 is a container platform
in or near Kenya — AWS `af-south-1` is the pragmatic default, a Kenyan
provider if the ODPC or a government partner requires domestic residency.

**That residency question still gates Phase 0.** It does not change the
application code, but it decides everything in this directory.

Pilot runs on Oracle Cloud Always Free (2 OCPU / 12 GB after the
15 June 2026 reduction) with Coolify. Recommendation from the cost work:
pay the ~$30/month for Oracle paid from Phase 1. Free that can be halved
under you is not free for something holding people's money.
