import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type Hls from 'hls.js';
import { WebApp } from '../telegram';

interface PlayerProps {
  iframeUrl: string;
  directHls?: string;
  subtitles?: { src: string; label: string }[];
  mirrors?: string[];
  initialTimecode?: number;
  mediaId?: string | number;
  onReady?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  season?: string;
  episode?: string;
  onEpisodeChange?: (season: string, episode: string) => void;
}

export function Player({
  iframeUrl,
  directHls,
  subtitles,
  mirrors,
  initialTimecode,
  onReady,
  onTimeUpdate,
  season,
  episode,
  onEpisodeChange
}: PlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const wakeLockRef = useRef<any>(null);
  const stalledWatchdogRef = useRef<any>(null);
  const lastSavedTimeRef = useRef<number>(0);

  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeLoadedRef = useRef(iframeLoaded);
  useEffect(() => { iframeLoadedRef.current = iframeLoaded; }, [iframeLoaded]);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [mirrorIndex, setMirrorIndex] = useState(0);

  // Latest season and episode references for background execution without stale closures
  const seasonRef = useRef(season);
  const episodeRef = useRef(episode);
  useEffect(() => { seasonRef.current = season; }, [season]);
  useEffect(() => { episodeRef.current = episode; }, [episode]);

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

  // Lock initial timecode once on mount/source change to prevent URL mutation on playback ticks
  const initialTimecodeRef = useRef(initialTimecode);
  const lastSourceKeyRef = useRef('');

  if (lastSourceKeyRef.current !== sourceKey) {
    lastSourceKeyRef.current = sourceKey;
    initialTimecodeRef.current = initialTimecode;
  }

  // Base iframe URL stripped of season/episode/timecode query mutations to prevent browser iframe reload
  const currentUrl = useMemo(() => {
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl.trim())) {
      return 'about:blank';
    }
    const timecode = initialTimecodeRef.current;
    let cleanUrl = rawUrl
      .replace(/[?&](start|t)=\d+/g, '')
      .replace(/[?&](season|episode)=\d+/g, '')
      .replace(/#t=\d+/g, '');
    if (cleanUrl.includes('?&')) cleanUrl = cleanUrl.replace('?&', '?');
    if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);

    if (!timecode || timecode <= 5) return cleanUrl;
    const startSec = Math.floor(timecode);
    if (cleanUrl.includes('?')) {
      return `${cleanUrl}&start=${startSec}#t=${startSec}`;
    }
    return `${cleanUrl}?start=${startSec}#t=${startSec}`;
  }, [rawUrl]);

  // Direct HLS engine initialization
  useEffect(() => {
    if (!directHls || useIframeFallback) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let isDestroyed = false;
    setVideoLoaded(false);

    let startupWatchdog: any = setTimeout(() => {
      if (!isDestroyed) {
        console.warn('[Player] HLS startup watchdog timed out (10s), falling back to iframe');
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        setUseIframeFallback(true);
      }
    }, 10000);

    const initPlayer = async () => {
      try {
        const { default: HlsClass } = await import('hls.js');
        if (isDestroyed) return;

        if (HlsClass.isSupported()) {
          if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
          }

          const hls = new HlsClass({
            startLevel: 0, // Force lowest level for first chunk -> instant start (<200ms)
            autoStartLoad: true,
            capLevelToPlayerSize: true,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1000 * 1000,
            nudgeOffset: 0.1, // Auto skip PTS micro-gaps
            nudgeMaxRetry: 5,
            enableWorker: true,
          });
          hlsRef.current = hls;

          hls.loadSource(directHls);
          hls.attachMedia(video);

          hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
            if (isDestroyed) return;
            if (startupWatchdog) {
              clearTimeout(startupWatchdog);
              startupWatchdog = null;
            }
            setVideoLoaded(true);
            onReady?.();
            const startSec = initialTimecodeRef.current;
            if (startSec && startSec > 5) {
              video.currentTime = Math.floor(startSec);
            }
            video.play().catch(() => {});
          });

          // Uncap quality after first fragment is buffered
          hls.on(HlsClass.Events.FRAG_BUFFERED, () => {
            if (hls.autoLevelEnabled === false && hls.currentLevel === 0) {
              hls.currentLevel = -1; // Auto adaptation takes over smoothly
            }
          });

          let fatalErrorCount = 0;
          hls.on(HlsClass.Events.ERROR, (_event, data) => {
            if (isDestroyed) return;
            if (data.fatal) {
              fatalErrorCount++;
              if (fatalErrorCount >= 3) {
                console.error('[Player] Fatal HLS errors exceeded limit (>=3), falling back to iframe:', data.details);
                if (startupWatchdog) {
                  clearTimeout(startupWatchdog);
                  startupWatchdog = null;
                }
                hls.destroy();
                hlsRef.current = null;
                setUseIframeFallback(true);
                return;
              }
              switch (data.type) {
                case HlsClass.ErrorTypes.NETWORK_ERROR:
                  console.warn('[Player] HLS network error, recovering...', data.details);
                  hls.startLoad();
                  break;
                case HlsClass.ErrorTypes.MEDIA_ERROR:
                  console.warn('[Player] HLS media error, recovering...', data.details);
                  hls.recoverMediaError();
                  break;
                default:
                  console.error('[Player] Unrecoverable HLS error, falling back to iframe:', data.details);
                  if (startupWatchdog) {
                    clearTimeout(startupWatchdog);
                    startupWatchdog = null;
                  }
                  hls.destroy();
                  hlsRef.current = null;
                  setUseIframeFallback(true);
                  break;
              }
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native Safari / iOS WebKit HLS
          video.src = directHls;
          const onLoadedMetadata = () => {
            if (isDestroyed) return;
            if (startupWatchdog) {
              clearTimeout(startupWatchdog);
              startupWatchdog = null;
            }
            setVideoLoaded(true);
            onReady?.();
            const startSec = initialTimecodeRef.current;
            if (startSec && startSec > 5) {
              video.currentTime = Math.floor(startSec);
            }
            video.play().catch(() => {});
          };
          const onError = () => {
            if (isDestroyed) return;
            console.warn('[Player] Native video error, falling back to iframe');
            if (startupWatchdog) {
              clearTimeout(startupWatchdog);
              startupWatchdog = null;
            }
            setUseIframeFallback(true);
          };

          video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
          video.addEventListener('error', onError, { once: true });
        } else {
          if (startupWatchdog) {
            clearTimeout(startupWatchdog);
            startupWatchdog = null;
          }
          setUseIframeFallback(true);
        }
      } catch (err) {
        console.error('[Player] Failed to load HLS engine, falling back to iframe:', err);
        if (startupWatchdog) {
          clearTimeout(startupWatchdog);
          startupWatchdog = null;
        }
        setUseIframeFallback(true);
      }
    };

    initPlayer();

    return () => {
      isDestroyed = true;
      if (startupWatchdog) {
        clearTimeout(startupWatchdog);
        startupWatchdog = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (stalledWatchdogRef.current) {
        clearTimeout(stalledWatchdogRef.current);
        stalledWatchdogRef.current = null;
      }
    };
  }, [directHls, useIframeFallback, onReady]);

  // Active PTS micro-gap watchdog: if video is active and stalls/buffers >1.2s, nudge forward 0.08s
  const handleWaitingOrStalled = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended) return;
    setIsBuffering(true);

    if (stalledWatchdogRef.current) clearTimeout(stalledWatchdogRef.current);
    stalledWatchdogRef.current = setTimeout(() => {
      if (video && !video.paused && !video.ended && video.readyState < 3) {
        console.log('[Player] PTS gap watchdog: nudging +0.08s across discontinuity');
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 0.08);
      }
    }, 1200);
  }, []);

  const handlePlaying = useCallback(() => {
    setIsBuffering(false);
    if (stalledWatchdogRef.current) {
      clearTimeout(stalledWatchdogRef.current);
      stalledWatchdogRef.current = null;
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nowSec = Math.floor(video.currentTime);
    if (nowSec > 0 && Math.abs(nowSec - lastSavedTimeRef.current) >= 4) {
      lastSavedTimeRef.current = nowSec;
      onTimeUpdate?.(nowSec);
    }
  }, [onTimeUpdate]);

  // Send playlist go command to the embedded video player (for iframe mode)
  const sendPlaylistGo = useCallback((targetSeason?: string, targetEpisode?: string) => {
    const s = targetSeason || seasonRef.current;
    const e = targetEpisode || episodeRef.current;
    if (!s && !e) return;

    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const sNum = parseInt(s || '1', 10);
        const eNum = parseInt(e || '1', 10);
        const eStr = String(e || '1');
        iframeRef.current.contentWindow.postMessage(
          { event: 'playlist go', season: sNum, episode: eNum },
          '*'
        );
        iframeRef.current.contentWindow.postMessage(
          { event: 'playlist go', season: sNum, episode: eStr },
          '*'
        );
      }
    } catch (_) {}
  }, []);

  // Listen for episode changes inside the embedded player (for iframe mode)
  useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== 'object') return;

        if (data.event === 'changeEpisode' && (data.season !== undefined || data.episode !== undefined)) {
          const s = String(data.season || '1');
          const e = String(data.episode || '1');
          onEpisodeChange?.(s, e);
        }
      } catch (_) {}
    };

    window.addEventListener('message', handlePlayerMessage);
    return () => window.removeEventListener('message', handlePlayerMessage);
  }, [onEpisodeChange]);

  const isInitialMountRef = useRef(true);
  const prevSeasonRef = useRef(season);
  const prevEpisodeRef = useRef(episode);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevSeasonRef.current = season;
      prevEpisodeRef.current = episode;
      return;
    }

    if ((season && season !== prevSeasonRef.current) || (episode && episode !== prevEpisodeRef.current)) {
      prevSeasonRef.current = season;
      prevEpisodeRef.current = episode;
      sendPlaylistGo(season, episode);
    }
  }, [season, episode, sendPlaylistGo]);

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
  };

  const isLoaded = directHls && !useIframeFallback ? videoLoaded : iframeLoaded;

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
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && document.hasFocus() && isLoaded) {
        try {
          if (!wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          }
        } catch (err) {}
      }
    };

    if (isLoaded) {
      requestWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        if (isLoaded) requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };

    const handleBlur = () => {
      releaseWakeLock();
    };

    const handleFocus = () => {
      if (isLoaded && document.visibilityState === 'visible') {
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
  }, [isLoaded]);

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
      if (iframeRef.current) {
        try {
          iframeRef.current.src = 'about:blank';
        } catch (_) {}
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch (_) {}
      }
    };
  }, []);

  const isSafeUrl = typeof currentUrl === 'string' && /^https?:\/\//i.test(currentUrl);
  if (!isSafeUrl && (!directHls || useIframeFallback)) {
    return null;
  }

  const isUsingDirect = Boolean(directHls && !useIframeFallback);

  return (
    <div ref={wrapperRef} className="player-wrapper relative overflow-hidden bg-black flex justify-center items-center group/player" style={{ width: '100%', aspectRatio: '16/9' }}>
      <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 bg-black px-8 transition-opacity duration-300 pointer-events-none ${isLoaded && !isBuffering ? 'opacity-0' : 'opacity-100'}`}>
        <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      </div>

      {directHls && (
        <button
          type="button"
          onClick={() => setUseIframeFallback(prev => !prev)}
          className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1 bg-black/70 hover:bg-black/90 backdrop-blur-md text-xs rounded-full border border-white/15 transition-opacity opacity-0 group-hover/player:opacity-100 cursor-pointer shadow-lg select-none"
          title={useIframeFallback ? 'Переключиться на быстрый нативный поток (HLS)' : 'Переключиться на плеер-донор (iframe)'}
        >
          {isUsingDirect ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-300 font-medium">Прямой HLS</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-amber-300 font-medium">Плеер-донор</span>
            </>
          )}
        </button>
      )}

      {isUsingDirect ? (
        <video
          ref={videoRef}
          className={`w-full h-full object-contain z-20 transition-opacity duration-300 ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
          controls
          playsInline
          preload="auto"
          onWaiting={handleWaitingOrStalled}
          onStalled={handleWaitingOrStalled}
          onPlaying={handlePlaying}
          onTimeUpdate={handleTimeUpdate}
        >
          {subtitles?.map((sub, idx) => (
            <track
              key={sub.src || idx}
              kind="subtitles"
              src={sub.src}
              srcLang={sub.label?.toLowerCase().includes('рус') ? 'ru' : 'en'}
              label={sub.label || `Субтитры ${idx + 1}`}
            />
          ))}
        </video>
      ) : (
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
      )}
    </div>
  );
}
