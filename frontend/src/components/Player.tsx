import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

export interface TargetEpisode {
  season: string;
  episode: string;
  token?: number;
}

interface PlayerProps {
  iframeUrl: string;
  mirrors?: string[];
  initialTimecode?: number;
  onReady?: () => void;
  targetEpisode?: TargetEpisode | null;
  onEpisodeChange?: (season: string, episode: string) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
  onClose?: () => void;
  onMinimize?: () => void;
  isTv?: boolean;
}

export function Player({ iframeUrl, mirrors, initialTimecode, onReady, targetEpisode, onEpisodeChange, onFullscreenChange, onClose, onMinimize, isTv = false }: PlayerProps) {
  const { t, language } = useLanguage();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wakeLockRef = useRef<any>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeLoadedRef = useRef(iframeLoaded);
  useEffect(() => { iframeLoadedRef.current = iframeLoaded; }, [iframeLoaded]);
  const [mirrorIndex, setMirrorIndex] = useState(0);
  // Число неудачных зеркал за текущий источник: защита от вечного цикла перезагрузок
  const mirrorAttemptsRef = useRef(0);
  useEffect(() => {
    // Новый фильм/новый список зеркал — счётчик попыток начинаем заново
    mirrorAttemptsRef.current = 0;
  }, [iframeUrl, mirrors]);

  // Compute full mirror list
  const activeMirrors = useMemo(() => {
    if (mirrors && mirrors.length > 0) {
      return mirrors;
    }
    return [iframeUrl];
  }, [iframeUrl, mirrors]);


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
    const startSec = Math.floor(timecode || 0);
    // Адаптация аудиодорожки под язык интерфейса: для не-русских интерфейсов передаем флаги автовыбора оригинальной/английской дорожки
    const langParams = !language.startsWith('ru') ? '&lang=en&audio=en&audio_lang=en' : '';
    // Для ТВ-эфира (isTv = true) передаем канонический параметр time=<секунды> напрямую в URL:
    // Серверный рендерер Liftw (embed.liftw.ws) инициализирует opts.time = <time>, запуская HLS с нужной секунды эфира.
    // Исключаем хэш #t= и дублирующие параметры start=/t=, вызывавшие дедлок буфера HLS донора.
    const timeParams = startSec > 5
      ? (isTv ? `&time=${startSec}` : `&start=${startSec}&time=${startSec}&t=${startSec}&timecode=${startSec}#t=${startSec}`)
      : '';
    const startParams = `&autoplay=1&autoPlay=1${timeParams}${langParams}`;
    if (cleanUrl.includes('?')) {
      return `${cleanUrl}${startParams}`;
    }
    return `${cleanUrl}?${startParams.slice(1)}`;
  }, [rawUrl, targetEpisode?.season, targetEpisode?.episode, language, isTv]);

  // Locked src state: tracks iframe URL. Fast-path uses postMessage('playlist go'),
  // verified fallback or season changes navigate iframe.src directly.
  const [lockedSrc, setLockedSrc] = useState<string>(currentUrl);
  const activeSourceKeyRef = useRef(sourceKey);
  const activeSeasonRef = useRef<string>(targetEpisode?.season || initialEpisodeRef.current?.season || '1');
  const pendingTargetRef = useRef<{ season: string; episode: string } | null>(null);
  const fallbackNavTimerRef = useRef<any>(null);

  // Reload iframe when source URL/origin changes
  if (activeSourceKeyRef.current !== sourceKey) {
    activeSourceKeyRef.current = sourceKey;
    activeSeasonRef.current = targetEpisode?.season || initialEpisodeRef.current?.season || '1';
    setLockedSrc(currentUrl);
  }

  // Verified donor commands: adFree (player-venom) + playlist go (opts.playlist).
  // Note: 'playlist hook' is intentionally excluded to preserve native autoPlay on stream change.
  const sendPlayCommands = useCallback((targetSeason?: string, targetEp?: string) => {
    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        // 1. Skip donor's VAST ad-wait and trigger instant playback
        iframeRef.current.contentWindow.postMessage(
          { event: 'adFree', free: true },
          '*'
        );
        iframeRef.current.contentWindow.postMessage(
          { event: 'play' },
          '*'
        );
        iframeRef.current.contentWindow.postMessage(
          { api: 'play' },
          '*'
        );
        if (initialTimecodeRef.current && initialTimecodeRef.current > 5) {
          const s = Math.floor(initialTimecodeRef.current);
          iframeRef.current.contentWindow.postMessage({ event: 'seek', time: s }, '*');
          iframeRef.current.contentWindow.postMessage({ api: 'seek', set: s }, '*');
          iframeRef.current.contentWindow.postMessage({ command: 'seek', time: s }, '*');
        }

        // 2. For series: command target season and episode without race-inducing repeats
        if (targetSeason || targetEp) {
          const sNum = parseInt(targetSeason || '1', 10);
          const eNum = parseInt(targetEp || '1', 10);
          iframeRef.current.contentWindow.postMessage(
            { event: 'playlist go', season: sNum, episode: eNum },
            '*'
          );
        }

        // 3. Адаптация аудиодорожки: для не-русского интерфейса шлём postMessage рукопожатие на переключение на английский / оригинал
        if (!language.startsWith('ru')) {
          iframeRef.current.contentWindow.postMessage(
            { event: 'setAudio', lang: 'en', audio: 'en', translation: 'original' },
            '*'
          );
          iframeRef.current.contentWindow.postMessage(
            { api: 'setTranslation', translation: 'en' },
            '*'
          );
          iframeRef.current.contentWindow.postMessage(
            { command: 'setAudio', lang: 'en' },
            '*'
          );
        }
      }
    } catch (_) {}
  }, [language]);

  // Listen for episode changes and player events inside embedded player
  useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      try {
        // Принимаем команды только от нашего iframe-донора: чужие iframe (реклама и т.п.)
        // не должны управлять переключением эпизодов и сбрасывать fallback-таймеры.
        if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;

        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== 'object') return;

        if (data.event === 'changeEpisode' && (data.season !== undefined || data.episode !== undefined)) {
          const s = String(data.season || '1');
          const e = String(data.episode || '1');

          // Check if this confirms our pending episode switch
          if (pendingTargetRef.current) {
            if (s === pendingTargetRef.current.season && e === pendingTargetRef.current.episode) {
              pendingTargetRef.current = null;
              if (fallbackNavTimerRef.current) {
                clearTimeout(fallbackNavTimerRef.current);
                fallbackNavTimerRef.current = null;
              }
            }
          }

          activeSeasonRef.current = s;
          onEpisodeChange?.(s, e);
        }
        if (data.event === 'playerReady' || data.event === 'startWatching' || data.event === 'play') {
          // Send adFree, play and initial seek handshake
          sendPlayCommands();
          // If player became ready while an episode change is pending, dispatch command immediately
          if (pendingTargetRef.current) {
            sendPlayCommands(pendingTargetRef.current.season, pendingTargetRef.current.episode);
          }
        }
        // When playback commences, clear pending fallback reload ONLY IF no pending episode switch
        if (
          data.event === 'adStart' || 
          data.event === 'startWatching' || 
          data.event === 'timeupdate' || 
          data.event === 'viewProgress' || 
          data.event === 'play'
        ) {
          if (!pendingTargetRef.current && fallbackNavTimerRef.current) {
            clearTimeout(fallbackNavTimerRef.current);
            fallbackNavTimerRef.current = null;
          }
        }
      } catch (_) {}
    };

    window.addEventListener('message', handlePlayerMessage);
    return () => {
      window.removeEventListener('message', handlePlayerMessage);
      if (fallbackNavTimerRef.current) {
        clearTimeout(fallbackNavTimerRef.current);
        fallbackNavTimerRef.current = null;
      }
    };
  }, [onEpisodeChange, targetEpisode?.season, targetEpisode?.episode, sendPlayCommands]);

  // Single trigger: command episode switch with fast-path + verified fallback
  const lastTargetTokenRef = useRef<number | null>(null);

  useEffect(() => {
    if (!targetEpisode) return;
    const token = targetEpisode.token ?? Date.now();
    if (token === lastTargetTokenRef.current) return;
    lastTargetTokenRef.current = token;

    // Skip if it's the initial episode mount (already rendered in iframe src URL)
    const isInitialSeasonEp = initialEpisodeRef.current &&
      targetEpisode.season === initialEpisodeRef.current.season &&
      targetEpisode.episode === initialEpisodeRef.current.episode;
    if (isInitialSeasonEp) return;

    // Season change requires direct iframe URL navigation
    const isSeasonChange = targetEpisode.season !== activeSeasonRef.current;
    if (isSeasonChange) {
      activeSeasonRef.current = targetEpisode.season;
      pendingTargetRef.current = null;
      if (fallbackNavTimerRef.current) {
        clearTimeout(fallbackNavTimerRef.current);
        fallbackNavTimerRef.current = null;
      }
      setLockedSrc(currentUrl);
      return;
    }

    // Episode switch within same season:
    // Fast-path: command playlist go without reloading iframe
    pendingTargetRef.current = { season: targetEpisode.season, episode: targetEpisode.episode };
    sendPlayCommands(targetEpisode.season, targetEpisode.episode);

    // Verified fallback: reload iframe with currentUrl if donor does not ack target episode within 5000ms (resilient against high mobile RTT/packet loss)
    if (fallbackNavTimerRef.current) {
      clearTimeout(fallbackNavTimerRef.current);
    }
    fallbackNavTimerRef.current = setTimeout(() => {
      if (pendingTargetRef.current) {
        setLockedSrc(currentUrl);
      }
      fallbackNavTimerRef.current = null;
    }, 5000);
  }, [targetEpisode, currentUrl, sendPlayCommands]);

  // Cleanup fallback navigation timer on unmount
  useEffect(() => {
    return () => {
      if (fallbackNavTimerRef.current) {
        clearTimeout(fallbackNavTimerRef.current);
        fallbackNavTimerRef.current = null;
      }
    };
  }, []);

  // Fallback timer for iframe
  useEffect(() => {
    setIframeLoaded(false);

    // Sentinel timer triggers mirror switch at 3500ms if iframe did not report load
    let sentinelTimer: any = null;
    if (activeMirrors.length > 1) {
      sentinelTimer = setTimeout(() => {
        if (!iframeLoadedRef.current) {
          // Полный круг по зеркалам без единого load: прекращаем вечное мигание,
          // терминальное состояние разблокирует fallback-таймер ниже.
          if (mirrorAttemptsRef.current + 1 >= activeMirrors.length) return;
          mirrorAttemptsRef.current += 1;
          setMirrorIndex((idx) => (idx + 1) % activeMirrors.length);
        }
      }, 3500);
    }

    // Fallback timer (5000ms): guarantees player UI unblocks if iframe never fires onload.
    // Страховка срабатывает только если onload так и не пришёл — иначе onReady дёргался дважды.
    const fallbackTimer = setTimeout(() => {
      if (!iframeLoadedRef.current) {
        setIframeLoaded(true);
        onReady?.();
      }
    }, 5000);

    return () => {
      clearTimeout(fallbackTimer);
      if (sentinelTimer) clearTimeout(sentinelTimer);
    };
  }, [lockedSrc, mirrorIndex, activeMirrors]);

  const handleIframeLoad = () => {
    setIframeLoaded(true);
    mirrorAttemptsRef.current = 0;
    onReady?.();

    // The iframe URL already embeds target season and episode in its src query params.
    // Send single play/adFree handshake once on mount without race-inducing episode bursts.
    sendPlayCommands();
  };

  // Power-Optimized WakeLock Lifecycle Management
  useEffect(() => {
    let disposed = false;
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
            const lock = await (navigator as any).wakeLock.request('screen');
            // Компонент мог размонтироваться, пока request() был в полёте: немедленно
            // освобождаем, иначе экран не гаснет после ухода со страницы.
            if (disposed) {
              try { await lock.release(); } catch (_) {}
              return;
            }
            wakeLockRef.current = lock;
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
      disposed = true;
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

  const exitWebFullscreen = useCallback(() => {
    setIsWebFullscreen(false);
  }, []);

  const handleExitFullscreenOrClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      exitWebFullscreen();
    }
  }, [onClose, exitWebFullscreen]);

  // Стабильный слушатель BackButton: Telegram хранит ссылку на хендлер, а identity
  // handleExitFullscreenOrClose меняется на каждый рендер — старые хендлеры оставались
  // зарегистрированными (двойной вызов back, вызовы после unmount).
  const backBtnHandlerRef = useRef(handleExitFullscreenOrClose);
  useEffect(() => { backBtnHandlerRef.current = handleExitFullscreenOrClose; });
  const backBtnListenerRef = useRef<(() => void) | null>(null);

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
          const listener = () => backBtnHandlerRef.current();
          backBtnListenerRef.current = listener;
          WebApp.BackButton.show();
          WebApp.BackButton.onClick(listener);
        } catch (_) {}
      }
      return () => {
        document.body.style.overflow = '';
        document.body.classList.remove('fullscreen-active');
        if (WebApp && WebApp.BackButton && backBtnListenerRef.current) {
          try {
            WebApp.BackButton.offClick(backBtnListenerRef.current);
          } catch (_) {}
          backBtnListenerRef.current = null;
        }
      };
    }

    document.body.style.overflow = '';
    document.body.classList.remove('fullscreen-active');
    return undefined;
  }, [isWebFullscreen]);

  // Auto-expand to Web Fullscreen strictly upon rotating to landscape, and auto-collapse upon rotating back to portrait
  const wasLandscapeRef = useRef(false);

  useEffect(() => {
    // В ТВ-режиме отключаем перехват экрана плеером: ориентацией и экраном управляет MediaBoxTvPlayer
    if (!isMobileDevice || isTv) return;

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
  }, [isMobileDevice, isTv]);

  // Orientation hint in portrait fullscreen mode (fades out after 4 seconds)
  const [showRotateHint, setShowRotateHint] = useState(true);
  useEffect(() => {
    if (isWebFullscreen && !isLandscape) {
      setShowRotateHint(true);
      const timer = setTimeout(() => setShowRotateHint(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [isWebFullscreen, isLandscape]);

  // Fullscreen controls auto-hide (fades out after 3.5 seconds of inactivity)
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef<any>(null);

  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    controlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3500);
  }, []);

  useEffect(() => {
    if (isWebFullscreen) {
      resetControlsTimeout();
    } else {
      setShowControls(true);
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    }
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, [isWebFullscreen, resetControlsTimeout]);

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
    try { WebApp.expand(); } catch (_) {}
    // На старых клиентах Telegram (Bot API < 6.2) этих методов нет — TypeError при
    // монтировании плеера без typeof-гарда
    if (typeof WebApp.enableClosingConfirmation === 'function') {
      try { WebApp.enableClosingConfirmation(); } catch (_) {}
    }
    if (WebApp.disableVerticalSwipes) {
      try { WebApp.disableVerticalSwipes(); } catch (_) {}
    }
    
    const platform = WebApp.platform || 'unknown';
    const isMobile = ['android', 'android_x', 'ios'].includes(platform);
    
    // В ТВ-режиме полноэкранным представлением управляет исключительно MediaBoxTvPlayer
    if (isMobile && WebApp.requestFullscreen && !isTv) {
      WebApp.requestFullscreen();
    }

    return () => {
      if (typeof WebApp.disableClosingConfirmation === 'function') {
        try { WebApp.disableClosingConfirmation(); } catch (_) {}
      }
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

  // NOTE: Объявлен до условного return — нарушение порядка хуков между рендерами крашит поддерево.
  const containerStyle = useMemo<React.CSSProperties>(() => {
    if (!isWebFullscreen || isTv) {
      // Сохраняем строгое соотношение 16:9 без вылета за границы родителя при любом aspect-ratio экрана
      return { width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', aspectRatio: '16/9' };
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
  }, [isWebFullscreen, isTv]);

  const isSafeUrl = typeof lockedSrc === 'string' && /^https?:\/\//i.test(lockedSrc);
  if (!isSafeUrl) {
    return null;
  }

  return (
    <div 
      ref={wrapperRef} 
      onPointerMove={isWebFullscreen ? resetControlsTimeout : undefined}
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
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay *; fullscreen *; encrypted-media *; picture-in-picture *; accelerometer *; gyroscope *"
        allowFullScreen
        style={{
          border: 'none',
          position: 'absolute',
          top: isWebFullscreen ? 'max(8px, env(safe-area-inset-top, 8px))' : 0,
          left: isWebFullscreen ? 'max(6px, env(safe-area-inset-left, 6px))' : 0,
          right: isWebFullscreen ? 'max(10px, env(safe-area-inset-right, 10px))' : 0,
          bottom: isWebFullscreen ? 'max(24px, env(safe-area-inset-bottom, 24px))' : 0,
          width: isWebFullscreen ? 'calc(100% - max(6px, env(safe-area-inset-left, 6px)) - max(10px, env(safe-area-inset-right, 10px)))' : '100%',
          height: isWebFullscreen ? 'calc(100% - max(8px, env(safe-area-inset-top, 8px)) - max(24px, env(safe-area-inset-bottom, 24px)))' : '100%',
        }}
      />

      {/* Center tap area to wake up hidden controls in fullscreen without blocking top-right gear or exit button */}
      {isWebFullscreen && (
        <div 
          onClick={resetControlsTimeout}
          onTouchStart={resetControlsTimeout}
          className={`absolute top-0 left-24 right-24 h-14 z-30 ${showControls ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'}`}
          style={{ touchAction: 'manipulation' }}
          aria-hidden="true"
        />
      )}

      {/* Floating exit/close/minimize buttons when in Web Fullscreen mode (auto-hides after 3.5s of inactivity) */}
      {isWebFullscreen && (
        <div className={`absolute top-4 left-4 z-40 flex items-center gap-2 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleExitFullscreenOrClose();
            }}
            className="px-3.5 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xl active:scale-95 transition-all cursor-pointer select-none"
            style={{ 
              paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))',
              paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0.75rem))'
            }}
          >
            <span className="text-sm leading-none">✕</span>
            <span>{onClose ? (t('close') || 'Закрыть') : (t('showLess') || 'Свернуть')}</span>
          </button>
          {onMinimize && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsWebFullscreen(false);
                onFullscreenChange?.(false);
                onMinimize();
              }}
              className="px-3.5 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xl active:scale-95 transition-all cursor-pointer select-none"
              title={t('minimize') || 'В окно'}
            >
              <span className="text-sm font-bold">⤓</span>
              <span>{t('minimize') || 'В окно'}</span>
            </button>
          )}
        </div>
      )}

      {/* Subtle orientation tip in portrait fullscreen mode */}
      {isWebFullscreen && isMobileDevice && !isLandscape && showRotateHint && (
        <div 
          className="absolute bottom-6 z-30 px-4 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white/90 text-xs font-semibold flex items-center gap-2 shadow-2xl pointer-events-none transition-opacity duration-500"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0.5rem))' }}
        >
          <span className="text-base">🔄</span>
          <span>{t('rotateDeviceHint')}</span>
        </div>
      )}
    </div>
  );
}
