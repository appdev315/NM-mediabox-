import { useState, useEffect } from 'react';

export type EffectiveConnectionType = '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';

export interface NetworkStatus {
  isOnline: boolean;
  effectiveType: EffectiveConnectionType;
  saveData: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const getEffectiveType = (): EffectiveConnectionType => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (conn && conn.effectiveType) {
      return conn.effectiveType as EffectiveConnectionType;
    }
    return 'unknown';
  };

  const getSaveData = (): boolean => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    return !!(conn && conn.saveData);
  };

  const [status, setStatus] = useState<NetworkStatus>(() => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    effectiveType: typeof navigator !== 'undefined' ? getEffectiveType() : 'unknown',
    saveData: typeof navigator !== 'undefined' ? getSaveData() : false,
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateOnlineStatus = () => {
      setStatus({
        isOnline: navigator.onLine,
        effectiveType: getEffectiveType(),
        saveData: getSaveData(),
      });
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (conn && conn.addEventListener) {
      conn.addEventListener('change', updateOnlineStatus);
    }

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      if (conn && conn.removeEventListener) {
        conn.removeEventListener('change', updateOnlineStatus);
      }
    };
  }, []);

  return status;
}
