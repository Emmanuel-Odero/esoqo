package payments

import "testing"

func TestPesaLinkTransferBankCode(t *testing.T) {
	cases := []struct {
		identifier string
		want       string
	}{
		{"0001", "1"},  // KCB
		{"0011", "11"}, // Co-operative Bank of Kenya
		{"0068", "68"}, // Equity Bank
		{"0005", "5"},  // Bank of India
		{"1015", "1015"},
		{"0000", "0"},
	}
	for _, c := range cases {
		if got := PesaLinkTransferBankCode(c.identifier); got != c.want {
			t.Errorf("PesaLinkTransferBankCode(%q) = %q, want %q", c.identifier, got, c.want)
		}
	}
}
