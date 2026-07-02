import React, { createContext, useContext, useEffect } from 'react';
import { WebApp } from '../telegram';

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
  // Cooldown setting (3 minutes for video)
  const COOLDOWN_MS = 3 * 60 * 1000; 
  // Cooldown setting (2 minutes for post)
  const POST_COOLDOWN_MS = 2 * 60 * 1000; 

  const isTelegram = !!WebApp.initDataUnsafe?.user;
  const isAdultQuery = window.location.href.includes('app=adult');
  const isAdultApp = window.location.hostname === 'media-box.xyz' || 
                     (window.location.hostname === 'localhost' && window.location.port === '3001') ||
                     isAdultQuery;
  
  // Dynamically load Adsgram script for Telegram users, but ONLY if not in adult app
  useEffect(() => {
    if (isTelegram && !isAdultApp && !(window as any).Adsgram) {
      const script = document.createElement('script');
      script.src = 'https://sad.adsgram.ai/js/sad.min.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, [isTelegram, isAdultApp]);

  const triggerAd = () => {
    if (!isTelegram || isAdultApp) {
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
    if (isTelegram && !isAdultApp) {
      const hasSeenStartup = sessionStorage.getItem('hasSeenStartupAd');
      if (!hasSeenStartup) {
        sessionStorage.setItem('hasSeenStartupAd', 'true');
        // Small delay to ensure Adsgram SDK is loaded
        setTimeout(() => triggerAd(), 1000); 
      }
    }
  }, [isTelegram]);

  const triggerPostAd = () => {
    if (!isTelegram || isAdultApp) return;

    const lastAdTimeStr = localStorage.getItem('lastAdsgramPostTime');
    const lastAdTime = lastAdTimeStr ? parseInt(lastAdTimeStr, 10) : 0;
    const now = Date.now();

    if (now - lastAdTime > POST_COOLDOWN_MS) {
      playAdsgramPost();
    }
  };

  const playAdsgramPost = () => {
    if (!(window as any).Adsgram) return;

    const AdController = (window as any).Adsgram.init({ blockId: "int-36857" });
    AdController.show().then(() => {
      localStorage.setItem('lastAdsgramPostTime', Date.now().toString());
    }).catch((result: any) => {
      console.error('Adsgram post ad error/skip:', result);
      localStorage.setItem('lastAdsgramPostTime', Date.now().toString());
    });
  };

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
    <AdContext.Provider value={{ triggerAd, triggerMovieAd: triggerAd, triggerPostAd }}>
      {children}
      
      {/* We no longer need the mock overlay because Adsgram draws its own iframe/overlay */}
    </AdContext.Provider>
  );
};
