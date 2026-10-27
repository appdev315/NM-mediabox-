import { useState, useCallback } from 'react';
import { WebApp } from '../telegram';

export function useAdultGate() {
  const [ageConfirmed, setAgeConfirmed] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && (window.location.search.includes('app=adult') || window.location.hostname === 'moviemaniak5555.xyz')) {
      try { localStorage.setItem('age_confirmed', 'true'); } catch (_) {}
      return true;
    }
    try {
      return localStorage.getItem('age_confirmed') === 'true';
    } catch (_) {
      return false;
    }
  });

  const confirmAge = useCallback(() => {
    try {
      WebApp?.HapticFeedback?.impactOccurred('heavy');
    } catch (_) {}
    try {
      localStorage.setItem('age_confirmed', 'true');
    } catch (_) {}
    setAgeConfirmed(true);
  }, []);

  return { ageConfirmed, confirmAge };
}
