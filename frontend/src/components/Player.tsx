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
}

export function Player({ iframeUrl, mirrors, initialTimecode, onReady, targetEpisode, onEpisodeChange }: PlayerProps) {
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

  // Verified donor commands: adFree (player-venom) + playlist go (embed page).
  const sendPlayCommands = useCallback((targetSeason?: string, targetEp?: string) => {
    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        // 1. Skip donor's VAST ad-wait and trigger instant playback
        iframeRef.current.contentWindow.postMessage(
          { event: 'adFree', free: true },
          '*'
        );

        // 2. For series: command target season and episode if provided
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
          if (currentTargetRef.current.season && currentTargetRef.current.episode) {
            if (s === currentTargetRef.current.season && e === currentTargetRef.current.episode) {
              syncDoneRef.current = true;
              clearSyncTimers();
            }
          }
        }
        if (data.event === 'playerReady') {
          if (!currentTargetRef.current.season) {
            syncDoneRef.current = true;
            clearSyncTimers();
          }
        }
        if (data.event === 'adStart' || data.event === 'startWatching') {
          syncDoneRef.current = true;
          clearSyncTimers();
        }
      } catch (_) {}
    };

    window.addEventListener('message', handlePlayerMessage);
    return () => {
      window.removeEventListener('message', handlePlayerMessage);
      clearSyncTimers();
    };
  }, [onEpisodeChange, clearSyncTimers]);

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
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture; accelerometer; gyroscope"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
      />
    </div>
  );
}
