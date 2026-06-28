import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { WebApp } from '../telegram';

interface AdContextType {
  triggerMovieAd: () => void;
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
  children: ReactNode;
}

export const AdProvider: React.FC<AdProviderProps> = ({ children }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [adType, setAdType] = useState<'adsgram' | 'monetag' | null>(null);
  
  // Cooldown setting (1 minute for testing, normally 10 mins)
  const COOLDOWN_MS = 1 * 60 * 1000; 

  const isTelegram = !!WebApp.initDataUnsafe?.user;

  useEffect(() => {
    // On app startup (only for Telegram)
    if (isTelegram) {
      const hasSeenStartup = sessionStorage.getItem('hasSeenStartupAd');
      if (!hasSeenStartup) {
        sessionStorage.setItem('hasSeenStartupAd', 'true');
        playAd('adsgram');
      }
    }
  }, [isTelegram]);

  const triggerMovieAd = () => {
    if (isTelegram) {
      // For Telegram, we only show startup ad, no movie prerolls
      return;
    }

    // For Web, we check the cooldown
    const lastAdTimeStr = localStorage.getItem('lastAdTime');
    const lastAdTime = lastAdTimeStr ? parseInt(lastAdTimeStr, 10) : 0;
    const now = Date.now();

    if (now - lastAdTime > COOLDOWN_MS) {
      playAd('monetag');
    }
  };

  const playAd = (type: 'adsgram' | 'monetag') => {
    setIsPlaying(true);
    setAdType(type);
    
    if (type === 'monetag') {
      localStorage.setItem('lastAdTime', Date.now().toString());
    }

    // Simulate ad duration
    setTimeout(() => {
      setIsPlaying(false);
      setAdType(null);
    }, 5000); // 5 seconds for testing
  };

  return (
    <AdContext.Provider value={{ triggerMovieAd }}>
      {children}
      
      {/* Ad Overlay Placeholder */}
      {isPlaying && (
        <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center text-white p-4">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <h2 className="text-2xl font-bold text-center mb-2">
            🎬 [TEST] Реклама {adType === 'adsgram' ? 'Adsgram' : 'Monetag'}...
          </h2>
          <p className="text-gray-400 text-center max-w-sm mb-6">
            В реальной версии здесь будет показываться {adType === 'adsgram' ? 'нативное видео от Adsgram' : 'Interstitial от Monetag'}.
          </p>
          <div className="bg-white/10 px-4 py-2 rounded-full">
             <p className="text-orange-500 animate-pulse font-medium">Пожалуйста, подождите (5 сек)...</p>
          </div>
        </div>
      )}
    </AdContext.Provider>
  );
};
