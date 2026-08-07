import { useEffect, useRef, useState, useMemo } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

interface PlayerProps {
  iframeUrl: string;
  mirrors?: string[];
  initialTimecode?: number;
  mediaId?: string | number;
  onReady?: () => void;
}

export function Player({ iframeUrl, mirrors, initialTimecode, onReady }: PlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<any>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [mirrorIndex, setMirrorIndex] = useState(0);
  const { t } = useLanguage();

  // Determine provider type
  const provider = useMemo(() => {
    if (iframeUrl.includes('xvideos') || iframeUrl.includes('xv-ru')) return 'xvideos';
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

  const rawUrl = activeMirrors[mirrorIndex] || iframeUrl;

  // Lock initial timecode on mount to prevent URL mutation on playback ticks
  const initialTimecodeRef = useRef(initialTimecode);

  // Compute stable sourceKey based on origin + pathname (ignoring query/timecode changes)
  const sourceKey = useMemo(() => {
    try {
      const url = new URL(rawUrl);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return rawUrl.split('?')[0].split('#')[0];
    }
  }, [rawUrl]);

  // Append restored timecode parameter when available
  const currentUrl = useMemo(() => {
    const timecode = initialTimecodeRef.current;
    if (!timecode || timecode <= 5) return rawUrl;
    const startSec = Math.floor(timecode);
    if (rawUrl.includes('#')) {
      return `${rawUrl}&t=${startSec}`;
    }
    if (rawUrl.includes('?')) {
      return `${rawUrl}&start=${startSec}#t=${startSec}`;
    }
    return `${rawUrl}?start=${startSec}#t=${startSec}`;
  }, [rawUrl]);

  // Fallback timer: Force show iframe after 6s even if onLoad doesn't fire (crucial for Movies/Series WebViews)
  useEffect(() => {
    setIframeLoaded(false);

    const fallbackTimer = setTimeout(() => {
      setIframeLoaded(true);
    }, 6000);

    // Auto-Fallback Sentinel for Adult multi-mirrors
    let sentinelTimer: any = null;
    if (activeMirrors.length > 1) {
      sentinelTimer = setTimeout(() => {
        if (!iframeLoaded) {
          const nextIdx = (mirrorIndex + 1) % activeMirrors.length;
          setMirrorIndex(nextIdx);
        }
      }, 3500);
    }

    return () => {
      clearTimeout(fallbackTimer);
      if (sentinelTimer) clearTimeout(sentinelTimer);
    };
  }, [currentUrl, mirrorIndex, activeMirrors]);

  // Loading progress bar animation
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
    onReady?.();
    if (provider !== 'generic') {
      try {
        const parsed = new URL(currentUrl);
        localStorage.setItem(`preferred_mirror_${provider}`, parsed.hostname);
      } catch (e) {}
    }
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
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && document.hasFocus() && iframeLoaded) {
        try {
          if (!wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          }
        } catch (err) {}
      }
    };

    if (iframeLoaded) {
      requestWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        if (iframeLoaded) requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };

    const handleBlur = () => {
      releaseWakeLock();
    };

    const handleFocus = () => {
      if (iframeLoaded && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
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

    return () => {
      WebApp.disableClosingConfirmation();
      if (isMobile && WebApp.exitFullscreen) {
        WebApp.exitFullscreen();
      }
    };
  }, []);

  return (
    <div ref={wrapperRef} className="player-wrapper relative overflow-hidden bg-black flex justify-center items-center group/player" style={{ width: '100%', aspectRatio: '16/9' }}>
      <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 bg-black px-8 transition-opacity duration-500 pointer-events-none ${iframeLoaded ? 'opacity-0' : 'opacity-100'}`}>
        <div className="w-full max-w-[200px] h-1.5 bg-gray-800 rounded-full overflow-hidden mb-4 shadow-inner">
          <div 
            className="h-full bg-[#fbbf24] transition-all duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
          />
        </div>
        <span className="text-[#fbbf24] text-xs font-bold tracking-wider uppercase">{t('loading')} {Math.round(loadingProgress)}%</span>
      </div>

      <iframe 
        id="video-iframe"
        key={sourceKey}
        src={currentUrl}
        onLoad={handleIframeLoad}
        className={`transition-opacity duration-300 z-20 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
      />
    </div>
  );
}
