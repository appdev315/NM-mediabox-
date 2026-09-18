import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { WebApp } from '../telegram';

export interface TargetEpisode {
  season: string;
  episode: string;
  token?: number;
}

interface PlayerProps {
  iframeUrl: string;
  mirrors?: string[];
  initialTimecode?: number;
  mediaId?: string | number;
  onReady?: () => void;
  targetEpisode?: TargetEpisode | null;
  onEpisodeChange?: (season: string, episode: string) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export function Player({ iframeUrl, mirrors, initialTimecode, onReady, targetEpisode, onEpisodeChange, onFullscreenChange }: PlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wakeLockRef = useRef<any>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeLoadedRef = useRef(iframeLoaded);
  useEffect(() => { iframeLoadedRef.current = iframeLoaded; }, [iframeLoaded]);
  const [mirrorIndex, setMirrorIndex] = useState(0);

  // Determine provider type
  const provider = useMemo(() => {
    if (iframeUrl.includes('xvideos') || iframeUrl.includes('xv-ru')) return 'xvideos';
    return 'generic';
  }, [iframeUrl]);

  // Compute full mirror list (xvideos.com first, xv-ru purged due to Cloudflare 429)
  const activeMirrors = useMemo(() => {
    if (mirrors && mirrors.length > 0) {
      return mirrors
        .map(m => m.replace('www.xv-ru.com', 'www.xvideos.com'))
        .filter(m => !m.includes('xv-ru.com'));
    }

    if (provider === 'xvideos') {
      const match = iframeUrl.match(/\/embedframe\/([^/?#]+)/);
      const id = match ? match[1] : '';
      if (id) {
        return [
          `https://www.xvideos.com/embedframe/${id}`,
          `https://www.xvideos2.com/embedframe/${id}`,
          `https://www.xvideos3.com/embedframe/${id}`,
          `https://www.xvideos.es/embedframe/${id}`
        ];
      }
    }
    return [iframeUrl];
  }, [iframeUrl, mirrors, provider]);

  // Read stored working mirror preference on launch, purging any stale xv-ru
  useEffect(() => {
    if (provider !== 'generic') {
      const savedDomain = localStorage.getItem(`preferred_mirror_${provider}`);
      if (savedDomain && savedDomain.includes('xv-ru')) {
        localStorage.removeItem(`preferred_mirror_${provider}`);
      } else if (savedDomain) {
        const foundIdx = activeMirrors.findIndex(m => m.includes(savedDomain));
        if (foundIdx !== -1 && foundIdx !== mirrorIndex) {
          setMirrorIndex(foundIdx);
          return;
        }
      }
    }
  }, [activeMirrors, provider, mirrorIndex]);

  const rawUrl = activeMirrors[mirrorIndex] || iframeUrl;

  // CRITICAL: Stable sourceKey based strictly on origin + pathname.
  const sourceKey = useMemo(() => {
    try {
      const url = new URL(rawUrl);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return rawUrl.split(/[?#]/)[0];
    }
  }, [rawUrl]);

  // Lock initial timecode and target episode once on mount/source change to prevent URL mutation on playback ticks
  const initialTimecodeRef = useRef(initialTimecode);
  const initialEpisodeRef = useRef(targetEpisode);
  const lastSourceKeyRef = useRef('');

  if (lastSourceKeyRef.current !== sourceKey) {
    lastSourceKeyRef.current = sourceKey;
    initialTimecodeRef.current = initialTimecode;
    initialEpisodeRef.current = targetEpisode;
  }

  // Base iframe URL: embeds target season & episode for instant server-rendered series playback
  const currentUrl = useMemo(() => {
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl.trim())) {
      return 'about:blank';
    }
    const epInfo = targetEpisode || initialEpisodeRef.current;
    let cleanUrl = rawUrl
      .replace(/[?&](start|t)=\d+/g, '')
      .replace(/[?&](season|episode)=\d+/g, '')
      .replace(/#t=\d+/g, '');
    if (cleanUrl.includes('?&')) cleanUrl = cleanUrl.replace('?&', '?');
    if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);

    if (epInfo?.season && epInfo?.episode) {
      const sep = cleanUrl.includes('?') ? '&' : '?';
      cleanUrl = `${cleanUrl}${sep}season=${encodeURIComponent(epInfo.season)}&episode=${encodeURIComponent(epInfo.episode)}`;
    }

    const isInitialEpisode = !targetEpisode || (
      targetEpisode.season === initialEpisodeRef.current?.season &&
      targetEpisode.episode === initialEpisodeRef.current?.episode
    );
    const timecode = isInitialEpisode ? initialTimecodeRef.current : 0;
    if (!timecode || timecode <= 5) return cleanUrl;
    const startSec = Math.floor(timecode);
    if (cleanUrl.includes('?')) {
      return `${cleanUrl}&start=${startSec}#t=${startSec}`;
    }
    return `${cleanUrl}?start=${startSec}#t=${startSec}`;
  }, [rawUrl, targetEpisode?.season, targetEpisode?.episode]);

  // Locked src state: freezes initial currentUrl for the active sourceKey so that
  // subsequent season/episode changes are handled via postMessage bursts without iframe DOM teardown.
  const [lockedSrc, setLockedSrc] = useState<string>(currentUrl);
  const activeSourceKeyRef = useRef(sourceKey);
  const fallbackNavTimerRef = useRef<any>(null);

  if (activeSourceKeyRef.current !== sourceKey) {
    activeSourceKeyRef.current = sourceKey;
    setLockedSrc(currentUrl);
  }

  // Fallback timer: if postMessage burst does not confirm episode change within 4s, fallback to updating lockedSrc
  useEffect(() => {
    if (!targetEpisode) return;

    if (fallbackNavTimerRef.current) {
      clearTimeout(fallbackNavTimerRef.current);
      fallbackNavTimerRef.current = null;
    }

    fallbackNavTimerRef.current = setTimeout(() => {
      if (!syncDoneRef.current) {
        setLockedSrc(currentUrl);
      }
    }, 4000);

    return () => {
      if (fallbackNavTimerRef.current) {
        clearTimeout(fallbackNavTimerRef.current);
        fallbackNavTimerRef.current = null;
      }
    };
  }, [targetEpisode, currentUrl]);

  // Verified donor commands: adFree (player-venom) + playlist hook/go (embed page).
  const sendPlayCommands = useCallback((targetSeason?: string, targetEp?: string) => {
    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        // 1. Establish Zenith hook handshake
        iframeRef.current.contentWindow.postMessage('playlist hook', '*');

        // 2. Skip donor's VAST ad-wait and trigger instant playback
        iframeRef.current.contentWindow.postMessage(
          { event: 'adFree', free: true },
          '*'
        );

        // 3. For series: command target season and episode if provided
        if (targetSeason || targetEp) {
          const sNum = parseInt(targetSeason || '1', 10);
          const eNum = parseInt(targetEp || '1', 10);
          const eStr = String(targetEp || '1');
          iframeRef.current.contentWindow.postMessage(
            { event: 'playlist go', season: sNum, episode: eNum },
            '*'
          );
          iframeRef.current.contentWindow.postMessage(
            { event: 'playlist go', season: sNum, episode: eStr },
            '*'
          );
          iframeRef.current.contentWindow.postMessage(
            'playlist hooked play',
            '*'
          );
        } else {
          // For movies or initial autoplay
          iframeRef.current.contentWindow.postMessage(
            'playlist hooked play',
            '*'
          );
        }
      }
    } catch (_) {}
  }, []);

  const syncDoneRef = useRef(false);
  const syncTimersRef = useRef<any[]>([]);
  const currentTargetRef = useRef<{ season?: string; episode?: string }>({});

  const clearSyncTimers = useCallback(() => {
    syncTimersRef.current.forEach((t) => {
      try { clearTimeout(t); } catch (_) {}
    });
    syncTimersRef.current = [];
  }, []);

  const startSyncBurst = useCallback((targetSeason?: string, targetEp?: string) => {
    clearSyncTimers();
    syncDoneRef.current = false;
    currentTargetRef.current = { season: targetSeason, episode: targetEp };
    const fireSync = () => {
      if (syncDoneRef.current) return;
      sendPlayCommands(targetSeason, targetEp);
    };
    fireSync();

    const retryDelays = [200, 500, 1000, 1800, 2600, 4200];
    retryDelays.forEach(delay => {
      syncTimersRef.current.push(setTimeout(fireSync, delay));
    });
  }, [clearSyncTimers, sendPlayCommands]);

  // Listen for episode changes and playerReady signals inside embedded player
  useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== 'object') return;

        if (data.event === 'changeEpisode' && (data.season !== undefined || data.episode !== undefined)) {
          const s = String(data.season || '1');
          const e = String(data.episode || '1');
          onEpisodeChange?.(s, e);
          // Note: Do NOT set syncDoneRef.current = true or clear sync timers here!
          // Zenith embed passively posts { event: 'changeEpisode', season: 1, episode: '1' }
          // during initial HTML parse before player-venom is downloaded or ready to autoplay.
          if (fallbackNavTimerRef.current && currentTargetRef.current.season && currentTargetRef.current.episode) {
            if (s === currentTargetRef.current.season && e === currentTargetRef.current.episode) {
              clearTimeout(fallbackNavTimerRef.current);
              fallbackNavTimerRef.current = null;
            }
          }
        }
        if (data.event === 'playerReady') {
          // player-venom scripts loaded and mounted - fire immediate burst
          if (currentTargetRef.current.season || currentTargetRef.current.episode) {
            sendPlayCommands(currentTargetRef.current.season, currentTargetRef.current.episode);
          } else {
            sendPlayCommands();
          }
        }
        // Genuine playback verification: only stop retries once playback or ad actually commences
        if (data.event === 'adStart' || data.event === 'startWatching' || data.event === 'timeupdate') {
          syncDoneRef.current = true;
          clearSyncTimers();
          if (fallbackNavTimerRef.current) {
            clearTimeout(fallbackNavTimerRef.current);
            fallbackNavTimerRef.current = null;
          }
        }
      } catch (_) {}
    };

    window.addEventListener('message', handlePlayerMessage);
    return () => {
      window.removeEventListener('message', handlePlayerMessage);
      clearSyncTimers();
    };
  }, [onEpisodeChange, clearSyncTimers, sendPlayCommands]);

  // Single trigger: fire burst only when user explicitly chooses an episode
  const lastTargetTokenRef = useRef<number | null>(null);

  useEffect(() => {
    if (targetEpisode) {
      const token = targetEpisode.token ?? Date.now();
      if (token !== lastTargetTokenRef.current) {
        lastTargetTokenRef.current = token;
        startSyncBurst(targetEpisode.season, targetEpisode.episode);
      }
    }
  }, [targetEpisode, startSyncBurst]);

  // Cleanup pending sync bursts on unmount
  useEffect(() => {
    return () => {
      clearSyncTimers();
    };
  }, [clearSyncTimers]);

  // Fallback timer for iframe
  useEffect(() => {
    setIframeLoaded(false);

    const fallbackTimer = setTimeout(() => {
      setIframeLoaded(true);
      onReady?.();
    }, 2000);

    let sentinelTimer: any = null;
    if (activeMirrors.length > 1) {
      sentinelTimer = setTimeout(() => {
        if (!iframeLoadedRef.current) {
          const nextIdx = (mirrorIndex + 1) % activeMirrors.length;
          setMirrorIndex(nextIdx);
        }
      }, 3500);
    }

    return () => {
      clearTimeout(fallbackTimer);
      if (sentinelTimer) clearTimeout(sentinelTimer);
    };
  }, [lockedSrc, mirrorIndex, activeMirrors]);

  const handleIframeLoad = () => {
    setIframeLoaded(true);
    onReady?.();
    if (provider !== 'generic') {
      try {
        const parsed = new URL(lockedSrc);
        localStorage.setItem(`preferred_mirror_${provider}`, parsed.hostname);
      } catch (e) {}
    }

    // Single transport: if episode already selected by user, run burst; otherwise send adFree for movies
    if (targetEpisode) {
      startSyncBurst(targetEpisode.season, targetEpisode.episode);
    } else {
      sendPlayCommands();
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

  // Web Fullscreen (DOM-level) to bypass native OS AVPlayer stall on mobile/PWA
  const [isWebFullscreen, setIsWebFullscreen] = useState(false);

  // Notify parent component of fullscreen transitions
  useEffect(() => {
    onFullscreenChange?.(isWebFullscreen);
  }, [isWebFullscreen, onFullscreenChange]);

  const isMobileDevice = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod|android/i.test(navigator.userAgent) || 
      (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
  }, []);

  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(orientation: landscape)').matches;
  });

  useEffect(() => {
    const mql = window.matchMedia('(orientation: landscape)');
    const update = () => setIsLandscape(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', update);
    } else {
      mql.addListener(update);
    }
    window.addEventListener('orientationchange', update);
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', update);
      } else {
        mql.removeListener(update);
      }
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  const toggleWebFullscreen = useCallback(() => {
    setIsWebFullscreen(prev => !prev);
  }, []);

  const exitWebFullscreen = useCallback(() => {
    setIsWebFullscreen(false);
  }, []);

  // Lock body scroll, manage global class, and configure Telegram WebApp when Web Fullscreen is active
  useEffect(() => {
    if (isWebFullscreen) {
      document.body.style.overflow = 'hidden';
      document.body.classList.add('fullscreen-active');
      if (WebApp && WebApp.requestFullscreen) {
        try { WebApp.requestFullscreen(); } catch (_) {}
      }
      if (WebApp && WebApp.BackButton) {
        try {
          WebApp.BackButton.show();
          WebApp.BackButton.onClick(exitWebFullscreen);
        } catch (_) {}
      }
    } else {
      document.body.style.overflow = '';
      document.body.classList.remove('fullscreen-active');
      if (WebApp && WebApp.BackButton) {
        try {
          // Unbind own exit listener without calling hide(), allowing global App.tsx router to keep page BackButton
          WebApp.BackButton.offClick(exitWebFullscreen);
        } catch (_) {}
      }
    }

    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('fullscreen-active');
      if (WebApp && WebApp.BackButton) {
        try {
          WebApp.BackButton.offClick(exitWebFullscreen);
        } catch (_) {}
      }
    };
  }, [isWebFullscreen, exitWebFullscreen]);

  // Auto-expand to Web Fullscreen strictly upon rotating to landscape, and auto-collapse upon rotating back to portrait
  const wasLandscapeRef = useRef(false);

  useEffect(() => {
    if (!isMobileDevice) return;

    const handleOrientationChange = () => {
      const landscape = window.matchMedia('(orientation: landscape)').matches;
      const compactLandscape = landscape && window.innerHeight < 600;

      if (compactLandscape && !wasLandscapeRef.current) {
        wasLandscapeRef.current = true;
        setIsWebFullscreen(true);
      } else if (!landscape && wasLandscapeRef.current) {
        wasLandscapeRef.current = false;
        setIsWebFullscreen(false);
      }
    };

    wasLandscapeRef.current = window.matchMedia('(orientation: landscape)').matches && window.innerHeight < 600;

    const mediaQuery = window.matchMedia('(orientation: landscape)');
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleOrientationChange);
    } else {
      mediaQuery.addListener(handleOrientationChange);
    }
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleOrientationChange);
      } else {
        mediaQuery.removeListener(handleOrientationChange);
      }
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [isMobileDevice]);

  // Orientation hint in portrait fullscreen mode (fades out after 4 seconds)
  const [showRotateHint, setShowRotateHint] = useState(true);
  useEffect(() => {
    if (isWebFullscreen && !isLandscape) {
      setShowRotateHint(true);
      const timer = setTimeout(() => setShowRotateHint(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [isWebFullscreen, isLandscape]);

  // Escape key handler to exit Web Fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isWebFullscreen) {
        exitWebFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isWebFullscreen, exitWebFullscreen]);

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

  const isSafeUrl = typeof lockedSrc === 'string' && /^https?:\/\//i.test(lockedSrc);
  if (!isSafeUrl) {
    return null;
  }

  const containerStyle = useMemo<React.CSSProperties>(() => {
    if (!isWebFullscreen) {
      return { width: '100%', aspectRatio: '16/9' };
    }
    return {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100vw',
      height: '100dvh',
      maxWidth: '100vw',
      maxHeight: '100dvh',
      zIndex: 99999,
      backgroundColor: '#000',
    };
  }, [isWebFullscreen]);

  return (
    <div 
      ref={wrapperRef} 
      className={`player-wrapper bg-black flex flex-col justify-center items-center ${
        isWebFullscreen 
          ? 'fixed inset-0 overflow-hidden' 
          : 'relative overflow-hidden group/player'
      }`} 
      style={containerStyle}
    >
      <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 bg-black px-8 transition-opacity duration-300 pointer-events-none ${iframeLoaded ? 'opacity-0' : 'opacity-100'}`}>
        <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      </div>

      <iframe 
        ref={iframeRef}
        id="video-iframe"
        key={sourceKey}
        src={lockedSrc}
        onLoad={handleIframeLoad}
        className={`transition-opacity duration-300 z-20 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
        loading="eager"
        referrerPolicy="no-referrer"
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture; accelerometer; gyroscope"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
      />

      {/* Transparent tap interceptor strictly on mobile devices in inline mode to prevent Apple AVPlayer stall. Unmounted in fullscreen to prevent blocking settings/controls. */}
      {isMobileDevice && !isWebFullscreen && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleWebFullscreen();
          }}
          aria-label="Во весь экран"
          title="Во весь экран"
          className="absolute bottom-0 right-0 w-7 h-7 z-30 cursor-pointer opacity-0 active:opacity-20 bg-white/30 transition-opacity"
          style={{ touchAction: 'manipulation' }}
        />
      )}

      {/* Floating exit button when in Web Fullscreen mode (desktop only, hidden on mobile phones) */}
      {isWebFullscreen && !isMobileDevice && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            exitWebFullscreen();
          }}
          className="absolute top-4 left-4 z-40 px-3.5 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xl active:scale-95 transition-all cursor-pointer select-none"
          style={{ 
            paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))',
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0.75rem))'
          }}
        >
          <span className="text-sm leading-none">✕</span>
          <span>Свернуть</span>
        </button>
      )}

      {/* Subtle orientation tip in portrait fullscreen mode */}
      {isWebFullscreen && isMobileDevice && !isLandscape && showRotateHint && (
        <div 
          className="absolute bottom-6 z-30 px-4 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white/90 text-xs font-semibold flex items-center gap-2 shadow-2xl pointer-events-none transition-opacity duration-500"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0.5rem))' }}
        >
          <span className="text-base">🔄</span>
          <span>Поверните телефон для полного экрана</span>
        </div>
      )}
    </div>
  );
}
