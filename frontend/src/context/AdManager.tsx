import React, { createContext, useContext, useMemo, useCallback } from 'react';


interface AdContextType {
  triggerAd: () => void;
  triggerMovieAd: () => void; // Keep for backward compatibility for now
  triggerPostAd: () => void;
}

const AdContext = createContext<AdContextType | undefined>(undefined);

export const useAdManager = () => {
  const context = useContext(AdContext);
  if (!context) {
    throw new Error('useAdManager must be used within an AdProvider');
  }
  return context;
};

interface AdProviderProps {
  children: React.ReactNode;
}

export const AdProvider: React.FC<AdProviderProps> = ({ children }) => {
  
  const triggerAd = useCallback(() => {
    // No-op for now
  }, []);

  const triggerPostAd = useCallback(() => {
    // No-op for now
  }, []);

  const value = useMemo(() => ({
    triggerAd,
    triggerMovieAd: triggerAd,
    triggerPostAd
  }), [triggerAd, triggerPostAd]);

  return (
    <AdContext.Provider value={value}>
      {children}
      
      {/* We no longer need the mock overlay because Adsgram draws its own iframe/overlay */}
    </AdContext.Provider>
  );
};
