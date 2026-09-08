package streamer

import (
	"net"
	"testing"
)

func TestIsIPSafe_PublicAndPrivate(t *testing.T) {
	testCases := []struct {
		ip       string
		expected bool // true = safe (allowed), false = blocked
	}{
		// Public IPv4 addresses (MUST be allowed)
		{"3.170.19.106", true}, // api.themoviedb.org
		{"8.8.8.8", true},      // Google DNS
		{"1.1.1.1", true},      // Cloudflare DNS
		{"142.250.180.206", true},

		// Private / Loopback / Link-Local IPv4 (MUST be blocked)
		{"127.0.0.1", false},
		{"10.0.0.1", false},
		{"192.168.1.1", false},
		{"172.16.0.1", false},
		{"169.254.169.254", false}, // AWS metadata
		{"0.0.0.0", false},
		{"255.255.255.255", false},

		// IPv6 Loopback / Private (MUST be blocked)
		{"::1", false},
		{"fe80::1", false},
		{"fc00::1", false},
	}

	for _, tc := range testCases {
		ip := net.ParseIP(tc.ip)
		if ip == nil {
			t.Fatalf("failed to parse IP %s", tc.ip)
		}
		actual := isIPSafe(ip)
		if actual != tc.expected {
			t.Errorf("isIPSafe(%s) = %v; expected %v", tc.ip, actual, tc.expected)
		}
	}
}
