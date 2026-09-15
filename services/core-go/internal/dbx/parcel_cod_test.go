package dbx

import "testing"

// The two pure rules that decide whose money is whose at a doorstep.
// Everything else in the COD chain is bookkeeping on top of these, so
// if they're wrong the ledger is wrong in a way no status column would
// reveal.

func TestCodExpectedKes(t *testing.T) {
	// Buyer pays for everything on arrival — the common arrangement here.
	if got := CodExpectedKes(2000, 500, true); got != 2500 {
		t.Errorf("CodExpectedKes(2000, 500, collectFee) = %v, want 2500", got)
	}
	// Sender prepaid the delivery; the buyer owes only the goods.
	if got := CodExpectedKes(2000, 500, false); got != 2000 {
		t.Errorf("CodExpectedKes(2000, 500, prepaid) = %v, want 2000", got)
	}
}

func TestAllocateCodCollectionAlwaysReconciles(t *testing.T) {
	// Fee + goods must add back up to exactly what was collected, for
	// every combination. A stranded cent here is money the ledger would
	// refuse to balance on.
	collections := []float64{0, 1, 499.99, 500, 500.01, 2500, 3333.33}
	prices := []float64{0, 120, 500, 910.55}
	for _, collected := range collections {
		for _, price := range prices {
			for _, collectFee := range []bool{true, false} {
				fee, goods := AllocateCodCollection(collected, price, collectFee)
				if diff := (fee + goods) - collected; diff > 0.005 || diff < -0.005 {
					t.Errorf("AllocateCodCollection(%v, %v, %v) = %v + %v, %v off the collection",
						collected, price, collectFee, fee, goods, diff)
				}
				if fee < 0 || goods < 0 {
					t.Errorf("AllocateCodCollection(%v, %v, %v) produced a negative share: %v / %v",
						collected, price, collectFee, fee, goods)
				}
			}
		}
	}
}

func TestAllocateCodCollectionSatisfiesTheFeeFirst(t *testing.T) {
	// The documented rule: the delivery happened and the fee was earned,
	// so a shortfall lands on the seller's goods rather than on Esoqo.
	// This is a real commercial decision, and a test is where it stops
	// being an accident of the arithmetic.
	fee, goods := AllocateCodCollection(2500, 500, true)
	if fee != 500 || goods != 2000 {
		t.Errorf("full payment should split 500/2000, got %v/%v", fee, goods)
	}

	// Buyer turns up 300 short.
	fee, goods = AllocateCodCollection(2200, 500, true)
	if fee != 500 || goods != 1700 {
		t.Errorf("a short payment should still cover the fee first, got %v/%v", fee, goods)
	}

	// Buyer has less than the delivery fee alone.
	fee, goods = AllocateCodCollection(300, 500, true)
	if fee != 300 || goods != 0 {
		t.Errorf("a collection below the fee is all fee, got %v/%v", fee, goods)
	}

	// Nothing collected: nothing moves, and no leg is posted.
	if fee, goods = AllocateCodCollection(0, 500, true); fee != 0 || goods != 0 {
		t.Errorf("an empty collection should allocate nothing, got %v/%v", fee, goods)
	}

	// A prepaid delivery means the whole collection is the seller's —
	// there is no fee left to satisfy, and skimming one here would take
	// the delivery fee twice.
	if fee, goods = AllocateCodCollection(2000, 500, false); fee != 0 || goods != 2000 {
		t.Errorf("a prepaid delivery should allocate everything to goods, got %v/%v", fee, goods)
	}
}

func TestAllocateCodCollectionOverpaymentGoesToTheSeller(t *testing.T) {
	// A buyer rounding up shouldn't quietly become Esoqo revenue.
	fee, goods := AllocateCodCollection(2600, 500, true)
	if fee != 500 || goods != 2100 {
		t.Errorf("an overpayment should ride with the goods money, got %v/%v", fee, goods)
	}
}
