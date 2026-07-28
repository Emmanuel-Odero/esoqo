# services/workers · Python

**Status: not started. Phase 2.**

Reconciliation, OCR, notifications and offline sync. Python for the
Tesseract bindings and because the scorecard work in Phase 4 lands here.

First job to build: the **payment break queue**. When an M-Pesa callback
never arrives, a human works the break and the trader is told plainly
that their money has not been taken twice. That single flow decides more
trust than anything else in the product.
