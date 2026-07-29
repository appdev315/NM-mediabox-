import { useEffect, useRef, useState, useMemo } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

interface PlayerProps {
  iframeUrl: string;
  mirrors?: string[];
}

export function Player({ iframeUrl, mirrors }: PlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [mirrorIndex, setMirrorIndex] = useState(0);
  const { t } = useLanguage();

  // Determine provider type
  const provider = useMemo(() => {
    if (iframeUrl.includes('xvideos') || iframeUrl.includes('xv-ru')) return 'xvideos';
    if (iframeUrl.includes('eporner')) return 'eporner';
    return 'generic';
  }, [iframeUrl]);

  // Compute full mirror list
  const activeMirrors = useMemo(() => {
    if (mirrors && mirrors.length > 0) return mirrors;

    if (provider === 'xvideos') {
      const match = iframeUrl.match(/\/embedframe\/([^/?#]+)/);
      const id = match ? match[1] : '';
      if (id) {
        return [
          `https://www.xv-ru.com/embedframe/${id}`,
          `https://www.xvideos2.com/embedframe/${id}`,
          `https://www.xvideos3.com/embedframe/${id}`,
          `https://www.xvideos.es/embedframe/${id}`,
          `https://www.xvideos.com/embedframe/${id}`
        ];
      }
    } else if (provider === 'eporner') {
      const match = iframeUrl.match(/\/embed\/([^/?#]+)/);
      const id = match ? match[1] : '';
      if (id) {
        return [
          `https://eporner.live/embed/${id}/`,
          `https://www.eporner.live/embed/${id}/`,
          `https://www.eporner.com/embed/${id}/`
        ];
      }
    }
    return [iframeUrl];
  }, [iframeUrl, mirrors, provider]);

  // Read stored working mirror preference on launch
  useEffect(() => {
    if (provider !== 'generic') {
      const savedDomain = localStorage.getItem(`preferred_mirror_${provider}`);
      if (savedDomain) {
        const foundIdx = activeMirrors.findIndex(m => m.includes(savedDomain));
        if (foundIdx !== -1) {
          setMirrorIndex(foundIdx);
          return;
        }
      }
    }
    setMirrorIndex(0);
  }, [iframeUrl, activeMirrors, provider]);

  const currentUrl = activeMirrors[mirrorIndex] || iframeUrl;

  // Auto-Fallback Sentinel: if current mirror fails to load within 3.5s, auto-rotate to next mirror!
  useEffect(() => {
    setIframeLoaded(false);
    
    const sentinelTimer = setTimeout(() => {
      if (!iframeLoaded && activeMirrors.length > 1) {
        const nextIdx = (mirrorIndex + 1) % activeMirrors.length;
        setMirrorIndex(nextIdx);
      }
    }, 3500);
    
    return () => clearTimeout(sentinelTimer);
  }, [currentUrl, mirrorIndex, activeMirrors, iframeLoaded]);

  // Loading progress bar animation - cleared immediately once loaded
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

  const handleIframeLoad = () => {
    setIframeLoaded(true);
    // Save working mirror domain to localStorage for instant future loads
    try {
      const parsed = new URL(currentUrl);
      localStorage.setItem(`preferred_mirror_${provider}`, parsed.hostname);
    } catch (e) {}
  };

  // Power-Optimized WakeLock Lifecycle Management
  useEffect(() => {
    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch (e) {}
        wakeLockRef.current = null;
      }
    };

    const requestWakeLock = async () => {
      // Only request Screen WakeLock when tab is active AND iframe is loaded
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && iframeLoaded) {
        try {
          if (!wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          }
        } catch (err) {
          // Wake lock rejected or unsupported
        }
      }
    };

    if (iframeLoaded) {
      requestWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (iframeLoaded) requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [iframeLoaded]);

  useEffect(() => {
    WebApp.expand();
    WebApp.enableClosingConfirmation();
    
    const platform = WebApp.platform || 'unknown';
    const isMobile = ['android', 'android_x', 'ios'].includes(platform);
    
    if (isMobile && WebApp.requestFullscreen) {
      WebApp.requestFullscreen();
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
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
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black px-8 pointer-events-none">
          <div className="w-full max-w-[200px] h-1.5 bg-gray-800 rounded-full overflow-hidden mb-4 shadow-inner">
            <div 
              className="h-full bg-[#fbbf24] transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
            />
          </div>
          <span className="text-[#fbbf24] text-xs font-bold tracking-wider uppercase">{t('loading')} {Math.round(loadingProgress)}%</span>
        </div>
      )}

      <iframe 
        id="video-iframe"
        key={currentUrl}
        src={currentUrl}
        onLoad={handleIframeLoad}
        className={`transition-opacity duration-300 z-20 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
      />

      {/* Control Overlay Buttons */}
      <div className="absolute top-2 right-2 flex items-center gap-2 z-30 opacity-80 hover:opacity-100 transition-opacity">
        {activeMirrors.length > 1 && (
          <button
            onClick={() => setMirrorIndex((mirrorIndex + 1) % activeMirrors.length)}
            className="bg-black/60 hover:bg-black/90 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-white/20 backdrop-blur-sm transition-transform active:scale-95"
            title="Switch Mirror"
          >
            🔄 Зеркало {mirrorIndex + 1}/{activeMirrors.length}
          </button>
        )}

        {provider === 'xvideos' && (
          <button 
            onClick={toggleFullscreen}
            className="bg-black/60 hover:bg-black/90 text-white p-1.5 rounded-lg border border-white/20 backdrop-blur-sm transition-transform active:scale-95"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
