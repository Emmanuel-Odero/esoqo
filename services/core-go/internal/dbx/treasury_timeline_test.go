package dbx

import "testing"

// formatTimelineEntry is what GroupTimeline actually shows a member —
// worth testing directly since it's the one function standing between
// a raw audit_event row and the plain-language line the whole feature
// exists to produce. No live Postgres pool needed.
func TestFormatTimelineEntry(t *testing.T) {
	cases := []struct {
		name     string
		action   string
		payload  map[string]interface{}
		wantLine string
		wantKind string
	}{
		{
			name:     "contribution declared",
			action:   "treasury.contribution.declared",
			payload:  map[string]interface{}{"contributorName": "Wanjiru", "amountKes": "500.00"},
			wantLine: "Wanjiru declared a contribution of KES 500.00 — awaiting confirmation",
			wantKind: "info",
		},
		{
			name:     "contribution confirmed",
			action:   "treasury.contribution.confirmed",
			payload:  map[string]interface{}{"contributorName": "Wanjiru", "amountKes": "500.00", "newBalanceKes": "84200.00"},
			wantLine: "KES 500.00 from Wanjiru confirmed — new balance KES 84200.00",
			wantKind: "posted",
		},
		{
			name:     "withdrawal requested",
			action:   "treasury.withdrawal.requested",
			payload:  map[string]interface{}{"amountKes": "12000.00", "payeeName": "John Kamau", "purpose": "School fees"},
			wantLine: "Withdrawal of KES 12000.00 requested for John Kamau — School fees",
			wantKind: "requested",
		},
		{
			name:     "withdrawal signed — approve, threshold not yet met",
			action:   "treasury.withdrawal.signed",
			payload:  map[string]interface{}{"decision": "APPROVE", "signerName": "Achieng", "resultingStatus": "PENDING_SIGNATURES"},
			wantLine: "Achieng approved the withdrawal",
			wantKind: "requested",
		},
		{
			name:     "withdrawal signed — approve, threshold reached",
			action:   "treasury.withdrawal.signed",
			payload:  map[string]interface{}{"decision": "APPROVE", "signerName": "Achieng", "resultingStatus": "APPROVED"},
			wantLine: "Achieng approved the withdrawal — threshold reached",
			wantKind: "posted",
		},
		{
			name:     "withdrawal signed — rejected, halts immediately",
			action:   "treasury.withdrawal.signed",
			payload:  map[string]interface{}{"decision": "REJECT", "signerName": "Otieno", "resultingStatus": "REJECTED"},
			wantLine: "Otieno rejected the withdrawal — request halted",
			wantKind: "rejected",
		},
		{
			name:     "withdrawal executed",
			action:   "treasury.withdrawal.executed",
			payload:  map[string]interface{}{"amountKes": "12000.00", "payeeName": "John Kamau"},
			wantLine: "Withdrawal of KES 12000.00 to John Kamau executed",
			wantKind: "posted",
		},
		{
			name:     "withdrawal expired",
			action:   "treasury.withdrawal.expired",
			payload:  map[string]interface{}{"amountKes": "12000.00"},
			wantLine: "Withdrawal of KES 12000.00 expired — threshold not reached in time",
			wantKind: "requested",
		},
		{
			name:     "unknown action falls back to the raw action string, not a dropped row",
			action:   "treasury.meeting.called",
			payload:  map[string]interface{}{},
			wantLine: "treasury.meeting.called",
			wantKind: "info",
		},
		{
			name:     "malformed/empty payload never panics",
			action:   "treasury.contribution.confirmed",
			payload:  nil,
			wantLine: "KES  from  confirmed — new balance KES ",
			wantKind: "posted",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			line, kind := formatTimelineEntry(tc.action, tc.payload)
			if line != tc.wantLine {
				t.Errorf("line = %q, want %q", line, tc.wantLine)
			}
			if kind != tc.wantKind {
				t.Errorf("kind = %q, want %q", kind, tc.wantKind)
			}
		})
	}
}
