import { useEffect, useRef, useState } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

interface PlayerProps {
  iframeUrl: string;
}

export function Player({ iframeUrl }: PlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const { t } = useLanguage();
  const isXvideos = iframeUrl.includes('xvideos.com');

  useEffect(() => {
    setIframeLoaded(false);
    
    // Fallback to hide spinner after 8 seconds if onLoad doesn't fire on mobile WebViews
    const timer = setTimeout(() => {
      setIframeLoaded(true);
    }, 8000);
    
    return () => clearTimeout(timer);
  }, [iframeUrl]);

  useEffect(() => {
    let interval: any;
    if (!iframeLoaded) {
      setLoadingProgress(0);
      interval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 95) {
            clearInterval(interval);
            return 95;
          }
          return prev + Math.random() * 8;
        });
      }, 300);
    } else {
      setLoadingProgress(100);
    }
    return () => clearInterval(interval);
  }, [iframeLoaded]);

  useEffect(() => {
    WebApp.expand();
    WebApp.enableClosingConfirmation();
    
    // Attempt to request true fullscreen if supported by the client (Bot API 8.0+)
    // Only do this on mobile platforms, as it's annoying on desktop/web
    const platform = WebApp.platform || 'unknown';
    const isMobile = ['android', 'android_x', 'ios'].includes(platform);
    
    if (isMobile && WebApp.requestFullscreen) {
      WebApp.requestFullscreen();
    }

    // Request screen wake lock to prevent screen from turning off/dimming during playback
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch (err) {
        console.error(`Wake Lock error:`, err);
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleFullscreenChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      if (wakeLock) {
        wakeLock.release().catch(console.error);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      WebApp.disableClosingConfirmation();
      if (isMobile && WebApp.exitFullscreen) {
        WebApp.exitFullscreen();
      }
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const el = wrapperRef.current as any;
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (el?.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el?.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen();
      }
    }
  };

  return (
    <div ref={wrapperRef} className="player-wrapper relative overflow-hidden bg-black flex justify-center items-center group/player" style={{ width: '100%', aspectRatio: '16/9' }}>
      {!iframeLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black px-8">
          <div className="w-full max-w-[200px] h-1.5 bg-gray-800 rounded-full overflow-hidden mb-4 shadow-inner">
            <div 
              className="h-full bg-[#fbbf24] transition-all duration-300 ease-out shadow-[0_0_10px_rgba(251,191,36,0.5)]"
              style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
            />
          </div>
          <span className="text-[#fbbf24] text-xs font-bold tracking-wider uppercase animate-pulse">{t('loading')} {Math.round(loadingProgress)}%</span>
        </div>
      )}
      <iframe 
        id="video-iframe"
        src={iframeUrl}
        onLoad={() => setIframeLoaded(true)}
        className={`transition-opacity duration-500 z-20 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
      />
      {isXvideos && (
        <button 
          onClick={toggleFullscreen}
          className="absolute top-2 right-2 bg-black/50 hover:bg-black/80 text-white p-2 rounded-lg z-10 transition-colors"
          title="Toggle Fullscreen"
        >
          {isFullscreen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          )}
        </button>
      )}
    </div>
  );
}
