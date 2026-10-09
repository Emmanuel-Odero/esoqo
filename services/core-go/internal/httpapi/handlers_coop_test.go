package httpapi

import (
	"testing"
	"time"
)

func TestCounterCancelableIn(t *testing.T) {
	if got := counterCancelableIn(nil); got != 0 {
		t.Fatalf("a push with no timestamp predates the column and is dead: want 0, got %d", got)
	}
	old := time.Now().Add(-counterPushCancelAfter - time.Second)
	if got := counterCancelableIn(&old); got != 0 {
		t.Fatalf("expired prompt should be cancelable now, got %d", got)
	}
	fresh := time.Now()
	if got := counterCancelableIn(&fresh); got <= 0 || got > int(counterPushCancelAfter.Seconds())+1 {
		t.Fatalf("a just-sent prompt must not be cancelable yet, got %d", got)
	}
}
