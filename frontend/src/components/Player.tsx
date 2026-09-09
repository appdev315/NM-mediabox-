import { useEffect, useRef, useState, useMemo } from 'react';
import { WebApp } from '../telegram';

interface PlayerProps {
  iframeUrl: string;
  mirrors?: string[];
  initialTimecode?: number;
  mediaId?: string | number;
  onReady?: () => void;
}

export function Player({ iframeUrl, mirrors, initialTimecode, onReady }: PlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wakeLockRef = useRef<any>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [mirrorIndex, setMirrorIndex] = useState(0);

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
        if (foundIdx !== -1 && foundIdx !== mirrorIndex) {
          setMirrorIndex(foundIdx);
          return;
        }
      }
    }
  }, [activeMirrors, provider, mirrorIndex]);

  const rawUrl = activeMirrors[mirrorIndex] || iframeUrl;

  // Compute stable sourceKey based on origin + pathname + season/episode (ignoring timecode/start/mirror noise)
  const sourceKey = useMemo(() => {
    try {
      const url = new URL(rawUrl);
      const s = url.searchParams.get('season') || '';
      const e = url.searchParams.get('episode') || '';
      return `${url.origin}${url.pathname}${s || e ? `?s=${s}&e=${e}` : ''}`;
    } catch (_) {
      return rawUrl.split('#')[0];
    }
  }, [rawUrl]);

  // Lock initial timecode once on mount/source change to prevent URL mutation on playback ticks
  const initialTimecodeRef = useRef(initialTimecode);
  const lastSourceKeyRef = useRef('');

  if (lastSourceKeyRef.current !== sourceKey) {
    lastSourceKeyRef.current = sourceKey;
    initialTimecodeRef.current = initialTimecode;
  }

  // Append restored timecode parameter when mounting initial player
  const currentUrl = useMemo(() => {
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl.trim())) {
      return 'about:blank';
    }
    const timecode = initialTimecodeRef.current;
    let cleanUrl = rawUrl.replace(/[?&](start|t)=\d+/g, '').replace(/#t=\d+/g, '');
    if (cleanUrl.includes('?&')) cleanUrl = cleanUrl.replace('?&', '?');
    if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);

    if (!timecode || timecode <= 5) return cleanUrl;
    const startSec = Math.floor(timecode);
    if (cleanUrl.includes('?')) {
      return `${cleanUrl}&start=${startSec}#t=${startSec}`;
    }
    return `${cleanUrl}?start=${startSec}#t=${startSec}`;
  }, [rawUrl]);

  // Fallback timer: Force show iframe after 2s even if onLoad doesn't fire (crucial for WebViews)
  useEffect(() => {
    setIframeLoaded(false);

    const fallbackTimer = setTimeout(() => {
      setIframeLoaded(true);
      onReady?.();
    }, 2000);

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
      // Force immediate WebKit / Blink video pipeline teardown and GPU memory release
      if (iframeRef.current) {
        try {
          iframeRef.current.src = 'about:blank';
        } catch (_) {}
      }
    };
  }, []);

  const isSafeUrl = typeof currentUrl === 'string' && /^https?:\/\//i.test(currentUrl);
  if (!isSafeUrl) {
    return null;
  }

  return (
    <div ref={wrapperRef} className="player-wrapper relative overflow-hidden bg-black flex justify-center items-center group/player" style={{ width: '100%', aspectRatio: '16/9' }}>
      <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 bg-black px-8 transition-opacity duration-300 pointer-events-none ${iframeLoaded ? 'opacity-0' : 'opacity-100'}`}>
        <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      </div>

      <iframe 
        ref={iframeRef}
        id="video-iframe"
        key={sourceKey}
        src={currentUrl}
        onLoad={handleIframeLoad}
        className={`transition-opacity duration-300 z-20 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
        loading="eager"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture; accelerometer; gyroscope"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
      />
    </div>
  );
}
