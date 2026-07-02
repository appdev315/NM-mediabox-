import React, { createContext, useContext } from 'react';


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
  
  const triggerAd = () => {
    // No-op for now as we're migrating to ExoClick
  };

  const triggerPostAd = () => {
    // No-op for now as we're migrating to ExoClick
  };

  return (
    <AdContext.Provider value={{ triggerAd, triggerMovieAd: triggerAd, triggerPostAd }}>
      {children}
      
      {/* We no longer need the mock overlay because Adsgram draws its own iframe/overlay */}
    </AdContext.Provider>
  );
};
