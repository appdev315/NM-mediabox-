import React, { createContext, useContext, useEffect } from 'react';
import { WebApp } from '../telegram';

interface AdContextType {
  triggerAd: () => void;
  triggerMovieAd: () => void; // Keep for backward compatibility for now
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
  // Cooldown setting (3 minutes)
  const COOLDOWN_MS = 3 * 60 * 1000; 

  const isTelegram = !!WebApp.initDataUnsafe?.user;
  
  // Dynamically load Adsgram script for Telegram users
  useEffect(() => {
    if (isTelegram && !(window as any).Adsgram) {
      const script = document.createElement('script');
      script.src = 'https://sad.adsgram.ai/js/sad.min.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, [isTelegram]);

  const triggerAd = () => {
    if (!isTelegram) {
      // Web Version: Not using Adsgram. 
      // Monetag Vignette handles web navigation automatically.
      return;
    }

    const lastAdTimeStr = localStorage.getItem('lastAdsgramTime');
    const lastAdTime = lastAdTimeStr ? parseInt(lastAdTimeStr, 10) : 0;
    const now = Date.now();

    if (now - lastAdTime > COOLDOWN_MS) {
      playAdsgramVideo();
    }
  };

  useEffect(() => {
    // On app startup (only for Telegram)
    if (isTelegram) {
      const hasSeenStartup = sessionStorage.getItem('hasSeenStartupAd');
      if (!hasSeenStartup) {
        sessionStorage.setItem('hasSeenStartupAd', 'true');
        // Small delay to ensure Adsgram SDK is loaded
        setTimeout(() => triggerAd(), 1000); 
      }
    }
  }, [isTelegram]);

  const playAdsgramVideo = () => {
    if (!(window as any).Adsgram) {
      console.warn('Adsgram SDK not loaded yet');
      return;
    }

    const AdController = (window as any).Adsgram.init({ blockId: "int-36858" });
    
    AdController.show().then(() => {
      // User watched the ad
      localStorage.setItem('lastAdsgramTime', Date.now().toString());
    }).catch((result: any) => {
      // Error or user closed it early
      console.error('Adsgram ad error/skip:', result);
      // We still set the cooldown so they don't get spammed if it's broken
      localStorage.setItem('lastAdsgramTime', Date.now().toString());
    });
  };

  return (
    <AdContext.Provider value={{ triggerAd, triggerMovieAd: triggerAd }}>
      {children}
      
      {/* We no longer need the mock overlay because Adsgram draws its own iframe/overlay */}
    </AdContext.Provider>
  );
};
