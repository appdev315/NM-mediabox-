export const PROJECT_START_DATE = new Date('2026-07-05T00:00:00Z');

export function getCurrentPhase() {
    const now = new Date();
    const diffTime = now.getTime() - PROJECT_START_DATE.getTime();
    
    // Total months roughly
    const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30.44);

    if (diffMonths < 2) {
        // Phase 1 (Months 1-2): private is 50, no lifetime, no free limits on movies/tv
        return {
            phase: 1,
            priceMonth: 50,
            priceLifetime: null,
            freeLimits: false,
            ads: true
        };
    } else if (diffMonths < 6) {
        // Phase 2 (Months 3-6)
        return {
            phase: 2,
            priceMonth: 50,
            priceLifetime: 200,
            freeLimits: true,
            ads: false
        };
    } else if (diffMonths < 12) {
        // Phase 3 (Months 7-12)
        return {
            phase: 3,
            priceMonth: 75,
            priceLifetime: 350,
            freeLimits: true,
            ads: false
        };
    } else {
        // Phase 4 (Month 12+)
        return {
            phase: 4,
            priceMonth: 75,
            priceLifetime: 500,
            freeLimits: true,
            ads: false
        };
    }
}
