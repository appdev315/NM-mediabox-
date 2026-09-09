package streamer

import (
	"context"
	"testing"
	"time"
)

func TestResolveAnwapMultilingual(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Test 1: Spanish original with diacritics and entity in mirror
	res, err := ResolveAnwap(ctx, "Room in Rome", "Комната в Риме", "Habitación en Roma", "38286")
	if err != nil {
		t.Fatalf("Expected Room in Rome to resolve, got error: %v", err)
	}
	if res == nil || res.URL == "" {
		t.Fatalf("Expected valid stream URL for Room in Rome")
	}
	t.Logf("Room in Rome stream resolved: %s", res.URL)

	// Test 2: Rare English indie drama
	res2, err := ResolveAnwap(ctx, "I Can't Think Straight", "Я не могу думать гетеросексуально", "", "14249")
	if err != nil {
		t.Fatalf("Expected I Can't Think Straight to resolve, got error: %v", err)
	}
	if res2 == nil || res2.URL == "" {
		t.Fatalf("Expected valid stream URL for I Can't Think Straight")
	}
	t.Logf("I Can't Think Straight stream resolved: %s", res2.URL)
}
