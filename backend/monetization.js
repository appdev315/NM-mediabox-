export const PROJECT_START_DATE = new Date('2026-07-05T00:00:00Z');

export function getCurrentPhase() {
    const now = new Date();
    const diffTime = now.getTime() - PROJECT_START_DATE.getTime();
    
    // Total months roughly
    const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30.44);

    if (diffMonths < 3) {
        // Phase 1 (Months 1-3): Month 50, Lifetime 250
        return {
            phase: 1,
            priceMonth: 50,
            priceLifetime: 250,
            freeLimits: false,
            ads: true
        };
    } else {
        // Phase 2 (Months 3+): Month 50, Lifetime 250
        return {
            phase: 2,
            priceMonth: 50,
            priceLifetime: 250,
            freeLimits: false,
            ads: true
        };
    }
}
