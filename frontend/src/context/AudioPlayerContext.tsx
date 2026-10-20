import React, { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useHlsPlayer } from '../hooks/useHlsPlayer';
import { EXPRESS_API_BASE } from '../hooks/useApi';
import { trackOpen, trackError } from '../utils/analytics';
import { audioEqualizerManager } from '../utils/audioEqualizerManager';
import { audioOfflineManager } from '../utils/audioOfflineManager';
import { favoritesManager } from '../utils/favoritesManager';
import { resolveFullAudioUrl, getNetworkSpeed, isMusicDataSaverEnabled } from '../hooks/useMusicApi';

export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  coverUrl?: string;
  type?: 'radio' | 'music';
  originalUrl?: string; // Original URL for fallback if proxied URL fails
}

interface AudioPlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  queue: Track[];
  isShuffle: boolean;
  toggleShuffle: () => void;
  setQueue: (queue: Track[]) => void;
  playTrack: (track: Track, newQueue?: Track[]) => void;
  togglePlayPause: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  stop: (fromRemote?: boolean | unknown) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined);

const AUDIO_STORAGE_KEY = 'mb_active_audio_state';

interface AudioSyncMessage {
  type: 'STATE_SYNC' | 'COMMAND_TOGGLE' | 'COMMAND_STOP' | 'PING_MASTER' | 'PONG_MASTER';
  track?: Track | null;
  isPlaying?: boolean;
  isBuffering?: boolean;
  masterId?: string;
  senderId: string;
}

// Dynamic Network Information helper with optimized live buffer for radio streams (keeps playback at live-edge)
const getOptimalBufferConfig = () => {
  return { maxBufferLength: 20, maxMaxBufferLength: 35, backBufferLength: 10 };
};

// Silent-prefetch helpers for music tracks (weak devices / unstable networks):
// resolve the final stream URL first, then call audio.play() exactly once.
const MUSIC_RESOLVE_TIMEOUT_MS = 9000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function needsFullResolve(t: Track): boolean {
  const u = t.url || '';
  return !u || u.includes('preview') || u.includes('mzstatic') || u.includes('itunes')
    || u.includes('dzcdn') || u.includes('invidious') || t.id.startsWith('yt_');
}

function prefetchNextTrack(current: Track, queue: Track[], shuffle: boolean): void {
  try {
    if (current.type !== 'music' || queue.length < 2) return;
    // No silent network work on metered links or with the Traffic saver toggle on:
    // warming competes with the live stream for bandwidth
    if (isMusicDataSaverEnabled() || getNetworkSpeed().isSlow) return;
    const idx = queue.findIndex((t) => t.id === current.id);
    if (idx < 0) return;
    const warm = (target: Track | undefined) => {
      if (!target || target.type !== 'music' || !target.id) return;
      if (!needsFullResolve(target)) return; // already has a direct stream
      (async () => {
        try {
          const u = await withTimeout(
            resolveFullAudioUrl(target.artist, target.title, target.url, target.id).catch(() => ''),
            8000,
            ''
          );
          if (u && !u.includes('preview') && !u.includes('dzcdn')) {
            target.url = u; // Pre-warm stream URL directly in queue item for 0ms synchronous lockscreen transition
          }
        } catch (_) {}
      })();
    };
    if (shuffle) {
      // Next pick is random at click-time, so warm one random candidate (probabilistic win,
      // misses are covered by the onError bypassCache retry)
      let r = Math.floor(Math.random() * queue.length);
      if (r === idx) r = (r + 1) % queue.length;
      warm(queue[r]);
    } else {
      // Warm both neighbors so lockscreen next AND prev both hit the sync fast-path
      warm(queue[(idx + 1) % queue.length]);
      warm(queue[(idx - 1 + queue.length) % queue.length]);
    }
  } catch (_) {}
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const queueRef = useRef<Track[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const [isShuffle, setIsShuffle] = useState(false);
  const isShuffleRef = useRef(false);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);

  const toggleShuffle = useCallback(() => {
    setIsShuffle(prev => !prev);
  }, []);

  const updateQueue = useCallback((newQueue: Track[]) => {
    setQueue(newQueue);
    queueRef.current = newQueue;
  }, []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isUserPausedRef = useRef(false); // Track if user explicitly clicked pause in UI
  const isPausedByDeviceRef = useRef(false); // Track if paused by headphone removal or OS audio focus
  const musicRetryTokenRef = useRef<string | null>(null); // Guard against infinite onError re-resolve loops
  const { hlsRef, initHls, destroyHls } = useHlsPlayer();
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const lastTimeRef = useRef(0);
  const stalledCountRef = useRef(0);
  const isRefreshingSrcRef = useRef(false);
  const lastPauseTimeRef = useRef(0);
  const activeBlobUrlRef = useRef<string | null>(null);
  const musicResolveRef = useRef(0); // invalidates stale music prefetch pipelines
  const resolvingIdRef = useRef<string | null>(null); // track id currently prefetching (double-tap guard)

  // Multi-window & PWA identity refs
  const tabIdRef = useRef(`tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const isAudioMasterRef = useRef(false);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Refs to always hold the latest state — avoids stale closures
  const isPlayingRef = useRef(isPlaying);
  const currentTrackRef = useRef(currentTrack);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);

  // Sync state to other active windows via in-memory BroadcastChannel
  const syncToPeers = useCallback((track: Track | null, playing: boolean, buffering: boolean) => {
    try {
      broadcastChannelRef.current?.postMessage({
        type: 'STATE_SYNC',
        track,
        isPlaying: playing,
        isBuffering: buffering,
        masterId: tabIdRef.current,
        senderId: tabIdRef.current
      });
    } catch (_) {}
  }, []);

  // Настройка нативной аудиосессии ОС (iOS/Android/macOS) для непрерывного фонового воспроизведения.
  // Исключает создание фиктивных параллельных <audio> элементов, предотвращая конфликт политик AirPlay и сброс A2DP.
  const startBackgroundShield = useCallback(() => {
    try {
      if ('audioSession' in navigator) {
        (navigator as any).audioSession.type = 'playback';
      }
    } catch (_) {}
  }, []);

  // Stable callbacks that read from refs instead of captured state
  const stop = useCallback((fromRemote: boolean | unknown = false) => {
    const isRemote = fromRemote === true;
    isUserPausedRef.current = true;
    isPausedByDeviceRef.current = false;
    isAudioMasterRef.current = false;
    musicResolveRef.current++;
    resolvingIdRef.current = null;

    // 1. Broadcast stop command to any other active windows ONLY if initiated locally (prevents ping-pong loop)
    if (!isRemote) {
      try {
        broadcastChannelRef.current?.postMessage({
          type: 'COMMAND_STOP',
          senderId: tabIdRef.current
        });
      } catch (_) {}
    }

    // 2. Unconditionally cancel any active reconnect timers
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // 3. Unconditionally destroy HLS instance if active
    destroyHls();

    // 3b. Release any active blob object URL
    if (activeBlobUrlRef.current) {
      try { URL.revokeObjectURL(activeBlobUrlRef.current); } catch (_) {}
      activeBlobUrlRef.current = null;
    }

    // 4. Unconditionally pause, clear src, and unload the audio element
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    // 5. Release OS audio stream
    audioEqualizerManager.suspendContext();

    // 6. Release system MediaSession lock
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      } catch (_) {}
    }

    // 7. Clear all React state
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTrack(null);
  }, []);

  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (isAudioMasterRef.current) {
        stop();
      }
    };
  }, [stop]);

  const attemptReconnect = useCallback((reason: string) => {
    const track = currentTrackRef.current;
    const audio = audioRef.current;
    if (!track || !audio || track.type !== 'radio' || isUserPausedRef.current) return;
    if (isReconnectingRef.current) return;

    // Resilient retry schedule: 12 attempts over ~2.5 minutes (prevents killing station when walking away with Bluetooth headphones)
    if (reconnectAttemptRef.current >= 12) {
      console.warn(`[Radio] Station ${track.title} connection paused after 12 retries.`);
      setIsBuffering(false);
      setIsPlaying(false);
      isReconnectingRef.current = false;
      try {
        trackError('radio', track.title || '', String(track.id), 'radio_offline_12x');
      } catch (_) {}
      return;
    }

    isReconnectingRef.current = true;
    reconnectAttemptRef.current++;
    setIsBuffering(true);
    console.warn(`[Radio] ${reason} — reconnect attempt #${reconnectAttemptRef.current}/12`);

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    // Gentle progressive backoff: 1.5s, 3s, 5s, 8s, 12s, max 15s (allows seamless Bluetooth/WiFi reconnection)
    const backoffTable = [1500, 2500, 4000, 6000, 8000, 10000, 12000, 15000];
    const baseBackoff = backoffTable[Math.min(reconnectAttemptRef.current - 1, backoffTable.length - 1)];
    const jitter = (Math.random() - 0.5) * 500;
    const backoffMs = Math.max(1000, baseBackoff + jitter);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isUserPausedRef.current) {
        isReconnectingRef.current = false;
        return;
      }

      // Prioritize direct station CDN for all secure HTTPS streams.
      // After repeated failures, fall back to the proxy for any non-proxied
      // URL (http mixed-content AND https without CORS headers — the latter
      // would otherwise play silence through the Web Audio equalizer chain).
      const rawUrl = track.originalUrl || track.url;
      let targetUrl = rawUrl;
      if (reconnectAttemptRef.current >= 4 && !targetUrl.includes('/proxy')) {
        targetUrl = `${EXPRESS_API_BASE}/proxy?url=${encodeURIComponent(rawUrl)}`;
      }

      const isHls = targetUrl.includes('.m3u8') || targetUrl.includes('/playlist');
      const baseUrl = targetUrl.split('&_t=')[0].split('?_t=')[0];
      const freshUrl = isHls ? targetUrl : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;

      if (isHls && hlsRef.current) {
        hlsRef.current.loadSource(freshUrl);
        hlsRef.current.startLoad();
        audio.play().then(() => {
          isReconnectingRef.current = false;
          setIsBuffering(false);
          setIsPlaying(true);
        }).catch(() => {
          isReconnectingRef.current = false;
          if (reconnectAttemptRef.current >= 6) {
            setIsBuffering(false);
            setIsPlaying(false);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('radio-station-broken', {
                detail: {
                  id: track.id,
                  title: track.title,
                  url: track.url,
                  originalUrl: track.originalUrl
                }
              }));
              try {
                trackError('radio', track.title || '', String(track.id), 'radio_offline_6x_hls');
              } catch (_) {}
            }
          }
        });
      } else {
        isRefreshingSrcRef.current = true;
        audio.src = freshUrl;
        audio.play().then(() => {
          isReconnectingRef.current = false;
          setIsBuffering(false);
          setIsPlaying(true);
        }).catch((err) => {
          console.warn('[Radio] Reconnect play failed:', err);
          isReconnectingRef.current = false;
          if (reconnectAttemptRef.current >= 6) {
            setIsBuffering(false);
            setIsPlaying(false);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('radio-station-broken', {
                detail: {
                  id: track.id,
                  title: track.title,
                  url: track.url,
                  originalUrl: track.originalUrl
                }
              }));
              try {
                trackError('radio', track.title || '', String(track.id), 'radio_offline_6x');
              } catch (_) {}
            }
          }
        }).finally(() => {
          isRefreshingSrcRef.current = false;
        });
      }
    }, backoffMs);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!isAudioMasterRef.current) {
      // Non-master tab: forward command to the master; master syncs state back.
      // Do not flip local state optimistically — it desyncs UI from real audio.
      try {
        broadcastChannelRef.current?.postMessage({
          type: 'COMMAND_TOGGLE',
          senderId: tabIdRef.current
        });
      } catch (_) {}
      return;
    }

    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (!audio || !track) return;

    // Check if audio is genuinely active and not paused by hardware route change
    const isActuallyPlaying = isPlayingRef.current && !audio.paused && !isPausedByDeviceRef.current;

    if (isActuallyPlaying) {
      isUserPausedRef.current = true;
      lastPauseTimeRef.current = Date.now();
      isPausedByDeviceRef.current = false;
      audio.pause();
      // Keep AudioContext active during temporary pause so lockscreen / remote unpause can resume audio immediately
      setIsPlaying(false);
      setIsBuffering(false);
      syncToPeers(track, false, false);
    } else {
      isUserPausedRef.current = false;
      isPausedByDeviceRef.current = false;
      setIsBuffering(true);
      startBackgroundShield();
      if (audioRef.current) {
        try {
          audioEqualizerManager.attachAudioElement(audioRef.current);
          audioEqualizerManager.resumeContext();
        } catch (_) {}
      }

      if (track.type === 'radio') {
        const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
        if (isHls && hlsRef.current) {
          hlsRef.current.startLoad();
          audio.play().then(() => {
            setIsPlaying(true);
            setIsBuffering(false);
            syncToPeers(track, true, false);
          }).catch((err) => {
            console.warn('[Radio] Unpause HLS play failed, attempting reconnect:', err);
            setIsBuffering(false);
            attemptReconnect('unpause hls play failed');
          });
        } else {
          // Mobile Optimization (iOS Safari / PWA / Android):
          // If paused recently (< 60s) and audio element already has src,
          // resume directly using audio.play() without resetting src.
          // This preserves the synchronous user touch gesture and prevents AbortError / autoplay blocks.
          const pauseDuration = Date.now() - (lastPauseTimeRef.current || 0);
          const canResumeDirectly = Boolean(audio.src) && pauseDuration < 60000;

          if (canResumeDirectly) {
            audio.play().then(() => {
              setIsPlaying(true);
              setIsBuffering(false);
              syncToPeers(track, true, false);
            }).catch((err) => {
              console.warn('[Radio] Direct unpause failed, refreshing stream URL:', err);
              // Fallback to fresh edge if stream socket was closed by server
              const rawUrl = track.originalUrl || track.url;
              const baseUrl = rawUrl.split('&_t=')[0].split('?_t=')[0];
              const freshUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
              isRefreshingSrcRef.current = true;
              audio.src = freshUrl;
              audio.play().then(() => {
                setIsPlaying(true);
                setIsBuffering(false);
                syncToPeers(track, true, false);
              }).catch((e2) => {
                console.warn('[Radio] Refresh unpause play failed:', e2);
                setIsBuffering(false);
                attemptReconnect('unpause stream play failed');
              }).finally(() => {
                isRefreshingSrcRef.current = false;
              });
            });
          } else {
            const rawUrl = track.originalUrl || track.url;
            const baseUrl = rawUrl.split('&_t=')[0].split('?_t=')[0];
            const freshUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
            isRefreshingSrcRef.current = true;
            audio.src = freshUrl;
            audio.play().then(() => {
              setIsPlaying(true);
              setIsBuffering(false);
              syncToPeers(track, true, false);
            }).catch((err) => {
              console.warn('[Radio] Unpause stream play failed, attempting reconnect:', err);
              setIsBuffering(false);
              attemptReconnect('unpause stream play failed');
            }).finally(() => {
              isRefreshingSrcRef.current = false;
            });
          }
        }
      } else {
        audio.play().then(() => {
          setIsPlaying(true);
          setIsBuffering(false);
          syncToPeers(track, true, false);
        }).catch((err) => {
          console.warn('[Audio] Music unpause direct play failed, attempting soft reload:', err);
          if (audio.src) {
            const currentPos = audio.currentTime;
            audio.load();
            if (currentPos > 0) {
              try { audio.currentTime = currentPos; } catch (_) {}
            }
            audio.play().then(() => {
              setIsPlaying(true);
              setIsBuffering(false);
              syncToPeers(track, true, false);
            }).catch((err2) => {
              console.warn('[Audio] Music unpause reload failed, refreshing stream URL:', err2);
              // Background pause recovery: if CDN socket closed during sleep, re-resolve and resume at current position
              (async () => {
                try {
                  const refreshed = await resolveFullAudioUrl(track.artist, track.title, track.url, track.id, true);
                  if (refreshed) {
                    audio.src = refreshed;
                    audio.load();
                    if (currentPos > 0) {
                      try { audio.currentTime = currentPos; } catch (_) {}
                    }
                    await audio.play();
                    setIsPlaying(true);
                    setIsBuffering(false);
                    syncToPeers({ ...track, url: refreshed }, true, false);
                  } else {
                    setIsBuffering(false);
                  }
                } catch (_) {
                  setIsBuffering(false);
                }
              })();
            });
          } else {
            setIsBuffering(false);
          }
        });
      }
    }
  }, [startBackgroundShield, syncToPeers, attemptReconnect]);

  // Silent prefetch for music: direct CDN stream (online) / offline blob (offline) -> bounded full-stream resolve ->
  // Silent prefetch for music: direct CDN stream (online) / offline blob (offline) -> bounded full-stream resolve ->
  // single audio.play() with the final URL. Never plays the preview aloud.
  const startMusicTrack = useCallback(async (track: Track, audio: HTMLAudioElement, myToken: number, bypassCache = false) => {
    const isStale = () => myToken !== musicResolveRef.current;
    const finishResolving = () => {
      if (musicResolveRef.current === myToken) resolvingIdRef.current = null;
    };
    try {
      let finalUrl = '';

      // 1. Читаем локальный оффлайн-кэш устройства СТРОГО для треков из «Избранного»
      const isFav = favoritesManager.isFavorite('music', track.id);

      if (isFav && !bypassCache) {
        try {
          const isCached = await audioOfflineManager.isAudioCached(track.url, track.id);
          if (isCached) {
            const isFastNet = !getNetworkSpeed().isSlow && !isMusicDataSaverEnabled() && typeof navigator !== 'undefined' && navigator.onLine !== false;
            // Апгрейд качества: если при плохой связи трек был сохранён в низком качестве (96k/48k),
            // а сейчас подключились к хорошей сети — запрашиваем и перезаписываем кэш максимальным 320 kbps качеством
            if (isFastNet) {
              const isLowQuality = await audioOfflineManager.isTrackCachedLowQuality(track.id, track.url);
              if (isLowQuality) {
                const high320 = await withTimeout(
                  resolveFullAudioUrl(track.artist, track.title, track.url, track.id, true /* bypassCache */).catch(() => ''),
                  MUSIC_RESOLVE_TIMEOUT_MS,
                  ''
                );
                if (high320 && !high320.includes('preview') && !high320.includes('dzcdn')) {
                  finalUrl = high320;
                  // В фоне бесшовно перезаписываем локальный кэш максимальным 320k качеством
                  audioOfflineManager.saveTrackAudio(track.id, high320, 'high').catch(() => {});
                }
              }
            }

            // Если апгрейд не требовался или сеть медленная/оффлайн — читаем локальный кэш мгновенно (0мс)
            if (!finalUrl) {
              const blob = await audioOfflineManager.getTrackAudioUrl(track.url, track.id);
              if (isStale()) {
                if (blob) { try { URL.revokeObjectURL(blob); } catch (_) {} }
                return;
              }
              if (blob) {
                if (activeBlobUrlRef.current && activeBlobUrlRef.current !== blob) {
                  try { URL.revokeObjectURL(activeBlobUrlRef.current); } catch (_) {}
                }
                activeBlobUrlRef.current = blob;
                finalUrl = blob;
              }
            }
          }
        } catch (_) {}
      }

      // 2. Resolve the full stream when online or when track is not in offline favorites
      if (!finalUrl) {
        if (bypassCache || needsFullResolve(track)) {
          const resolved = await withTimeout(
            resolveFullAudioUrl(track.artist, track.title, track.url, track.id, bypassCache).catch(() => ''),
            MUSIC_RESOLVE_TIMEOUT_MS,
            ''
          );
          if (isStale()) return;
          finalUrl = resolved || '';
        } else {
          finalUrl = track.url;
        }

        // 3. Fallback to offline cache if network resolution failed and track is a favorite
        if (!finalUrl && isFav && !bypassCache) {
          try {
            const blob = await audioOfflineManager.getTrackAudioUrl(track.url, track.id);
            if (isStale()) {
              if (blob) { try { URL.revokeObjectURL(blob); } catch (_) {} }
              return;
            }
            if (blob) {
              if (activeBlobUrlRef.current && activeBlobUrlRef.current !== blob) {
                try { URL.revokeObjectURL(activeBlobUrlRef.current); } catch (_) {}
              }
              activeBlobUrlRef.current = blob;
              finalUrl = blob;
            }
          } catch (_) {}
        }
      }

      // Pre-warm the queue entry with the resolved URL to avoid repeated network round-trips
      if (finalUrl && !finalUrl.startsWith('blob:')) {
        const qIndex = queueRef.current.findIndex(t => t.id === track.id);
        if (qIndex !== -1) {
          queueRef.current[qIndex] = { ...queueRef.current[qIndex], url: finalUrl };
        }
      }

      // Strictly Full Tracks: Refuse to play any 30-second preview cut!
      const isPreview = !finalUrl || finalUrl.includes('preview') || finalUrl.includes('dzcdn');
      if (isPreview) {
        console.warn(`[Audio] Full track stream unavailable for ${track.artist} - ${track.title}, refusing 30s preview`);
        finishResolving();
        setIsBuffering(false);
        setIsPlaying(false);
        syncToPeers(track, false, false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('music-track-unavailable', {
            detail: { title: track.title, artist: track.artist, id: track.id }
          }));
          try {
            trackError('music', track.title || '', String(track.id), 'full_stream_unavailable');
          } catch (_) {}
        }
        return;
      }

      // Если трек в Избранном, но ещё не сохранён в локальный кэш — фоново сохраняем его на устройство
      if (isFav && finalUrl && !finalUrl.startsWith('blob:')) {
        const isSlowNet = getNetworkSpeed().isSlow || isMusicDataSaverEnabled();
        audioOfflineManager.saveTrackAudio(track.id, finalUrl, isSlowNet ? 'low' : 'high').catch(() => {});
      }

      // Cache-hot: the same bytes are already playing (e.g. instant replay).
      if (audio.currentSrc === finalUrl && !audio.paused) {
        finishResolving();
        const hotTrack = { ...track, url: finalUrl };
        setCurrentTrack(hotTrack);
        setIsPlaying(true);
        setIsBuffering(false);
        syncToPeers(hotTrack, true, false);
        return;
      }

      const resolvedTrack: Track = { ...track, url: finalUrl };
      setCurrentTrack(resolvedTrack);
      isRefreshingSrcRef.current = true;
      audio.preload = 'auto';
      audio.src = finalUrl;
      audio.load();
      isRefreshingSrcRef.current = false;
      finishResolving();

      // Защита от гонки: если пользователь уже переключил на другой трек, глушим звук
      if (isStale()) {
        try { audio.pause(); } catch (_) {}
        return;
      }

      try {
        await audio.play();
        if (isStale()) {
          try { audio.pause(); } catch (_) {}
          return;
        }
        setIsPlaying(true);
        setIsBuffering(false);
        syncToPeers(resolvedTrack, true, false);
        prefetchNextTrack(resolvedTrack, queueRef.current, isShuffleRef.current);
        trackOpen('music', `${resolvedTrack.artist} - ${resolvedTrack.title}`, resolvedTrack.id);
      } catch (err) {
        if (isStale()) return;
        console.warn('[Audio] music play failed:', err);
        setIsBuffering(false);
        setIsPlaying(false);
        syncToPeers(resolvedTrack, false, false);
      }
    } catch (e) {
      if (isStale()) return;
      finishResolving();
      setIsBuffering(false);
      setIsPlaying(false);
      syncToPeers(track, false, false);
    }
  }, [syncToPeers]);

  const playTrack = useCallback(async (track: Track, newQueue?: Track[]) => {
    if (newQueue && newQueue.length > 0) {
      setQueue(newQueue);
      queueRef.current = newQueue;
    } else if (!queueRef.current.some(t => t.id === track.id)) {
      const updated = [track, ...queueRef.current];
      setQueue(updated);
      queueRef.current = updated;
    }

    const cleanId = (id: string | number | undefined) => String(id || '').replace(/^saavn_/, '');
    const requestedId = cleanId(track.id);
    // Same track: ignore double-taps while prefetching, retry when src was
    // never set (failed resolve), otherwise toggle play/pause.
    if (cleanId(currentTrackRef.current?.id) === requestedId && resolvingIdRef.current !== requestedId) {
      const a = audioRef.current;
      if (!(track.type === 'music' && a && !a.src)) {
        togglePlayPause();
        return;
      }
    }
    if (resolvingIdRef.current === requestedId) return;

    // Stop playback in any other open window/tab to prevent dual streams
    try {
      broadcastChannelRef.current?.postMessage({
        type: 'COMMAND_STOP',
        senderId: tabIdRef.current
      });
    } catch (_) {}

    // Мгновенно глушим текущий звук старого трека или радио,
    // чтобы при выборе песни (из Избранного, Радио или Поиска) не было параллельного наложения двух звуков
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (_) {}
    }

    isAudioMasterRef.current = true;
    musicRetryTokenRef.current = null;
    const myToken = ++musicResolveRef.current;
    resolvingIdRef.current = requestedId;

    const audio = audioRef.current;
    if (!audio) {
      resolvingIdRef.current = null;
      return;
    }

    // New track
    startBackgroundShield();
    if (audio) {
      try {
        audioEqualizerManager.attachAudioElement(audio);
        audioEqualizerManager.reapplySettings();
      } catch (_) {}
    }
    isUserPausedRef.current = false;
    reconnectAttemptRef.current = 0;
    isReconnectingRef.current = false;
    stalledCountRef.current = 0;
    lastTimeRef.current = 0;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clean up previous Hls instance
    destroyHls();

    // Instant row feedback (spinner, no sound yet) — the URL resolves silently below.
    setCurrentTrack(track);
    setIsBuffering(true);
    syncToPeers(track, true, true);

    if (track.type === 'music') {
      const isFav = favoritesManager.isFavorite('music', track.id);

      // Синхронный fast-path ТОЛЬКО для не-избранных треков из поиска с уже разрешённым прямым URL.
      // Треки из «Избранного» направляются в startMusicTrack, где проверяется локальный оффлайн-кэш
      // (0 мс задержки, 0 байт мобильного трафика) и автоматический апгрейд качества до 320 kbps.
      if (!isFav && !needsFullResolve(track) && track.url && !track.url.includes('preview') && !track.url.includes('dzcdn')) {
        const resolvedTrack = track;
        setCurrentTrack(resolvedTrack);
        if (audio.src !== track.url) {
          isRefreshingSrcRef.current = true;
          audio.preload = 'auto';
          audio.src = track.url;
          audio.load();
          isRefreshingSrcRef.current = false;
        }
        resolvingIdRef.current = null;
        try {
          await audio.play();
          if (myToken !== musicResolveRef.current) {
            try { audio.pause(); } catch (_) {}
            return;
          }
          setIsPlaying(true);
          setIsBuffering(false);
          syncToPeers(resolvedTrack, true, false);
          prefetchNextTrack(resolvedTrack, queueRef.current, isShuffleRef.current);
          trackOpen('music', `${resolvedTrack.artist} - ${resolvedTrack.title}`, resolvedTrack.id);
          return;
        } catch (err) {
          console.warn('[Audio] Fast-path play failed, falling back to full resolver:', err);
        }
      }

      await startMusicTrack(track, audio, myToken);
      return;
    }
    resolvingIdRef.current = null;

    audio.preload = 'auto';

    const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
      
    if (isHls) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        isRefreshingSrcRef.current = true;
        audio.src = track.url;
        isRefreshingSrcRef.current = false;
      } else {
        const bufferCfg = getOptimalBufferConfig();
        const hls = await initHls({
          url: track.url,
          media: audio,
          config: {
            maxBufferLength: bufferCfg.maxBufferLength,
            maxMaxBufferLength: bufferCfg.maxMaxBufferLength,
            backBufferLength: bufferCfg.backBufferLength,
            maxBufferHole: 0.5,
            startFragPrefetch: true,
            maxBufferSize: 4 * 1024 * 1024,
            liveSyncDuration: 3,
            liveMaxLatencyDuration: 10,
            manifestLoadingMaxRetry: 10,
            levelLoadingMaxRetry: 10,
            fragLoadingMaxRetry: 10,
            maxFragLookUpTolerance: 0.25,
          },
          onError: (instance, data) => {
            if (data.fatal) {
              switch (data.type) {
                case 'networkError':
                  console.warn('[HLS] Network error encountered, attempting recovery...');
                  instance.startLoad();
                  break;
                case 'mediaError':
                  console.warn('[HLS] Media error encountered, recovering media...');
                  instance.recoverMediaError();
                  break;
                default:
                  console.error('[HLS] Fatal error, delegating to attemptReconnect...');
                  attemptReconnect('hls fatal error');
                  break;
              }
            }
          },
        });

        if (!hls) {
          isRefreshingSrcRef.current = true;
          audio.src = track.url;
          audio.load();
          isRefreshingSrcRef.current = false;
        }
      }
    } else {
      isRefreshingSrcRef.current = true;
      audio.src = track.url;
      audio.load();
      isRefreshingSrcRef.current = false;
    }

    // Гонка быстрого переключения: пока await initHls был в полёте, пользователь мог
    // выбрать другой трек (токен инкрементирован) или поставить паузу. Не затираем
    // src нового трека старым URL и не врём в UI.
    if (myToken !== musicResolveRef.current || isUserPausedRef.current) {
      return;
    }

    audio.play().then(() => {
      setIsPlaying(true);
      setIsBuffering(false);
      syncToPeers(track, true, false);
    }).catch((err) => {
      console.warn('[Audio] playTrack error, delegating to attemptReconnect:', err);
      setIsBuffering(false);
      setIsPlaying(false);
      attemptReconnect('playTrack play error');
    });
  }, [attemptReconnect, togglePlayPause, startBackgroundShield, syncToPeers, startMusicTrack, initHls, destroyHls]);

  const nextTrack = useCallback(() => {
    const currentQueue = queueRef.current;
    if (!currentQueue || currentQueue.length === 0) return;
    const current = currentTrackRef.current;
    const currentIndex = current ? currentQueue.findIndex(t => t.id === current.id) : -1;
    let nextIndex = 0;
    if (isShuffleRef.current && currentQueue.length > 1) {
      let rand = Math.floor(Math.random() * currentQueue.length);
      if (rand === currentIndex) {
        rand = (rand + 1) % currentQueue.length;
      }
      nextIndex = rand;
    } else {
      nextIndex = (currentIndex + 1) % currentQueue.length;
    }
    const target = currentQueue[nextIndex];
    if (target) {
      playTrack(target);
    }
  }, [playTrack]);

  const prevTrack = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      if (audio.paused) {
        audio.play().catch(() => {});
      }
      return;
    }

    const currentQueue = queueRef.current;
    if (!currentQueue || currentQueue.length === 0) return;
    const current = currentTrackRef.current;
    const currentIndex = current ? currentQueue.findIndex(t => t.id === current.id) : -1;
    const prevIndex = (currentIndex - 1 + currentQueue.length) % currentQueue.length;
    const target = currentQueue[prevIndex];
    if (target) {
      playTrack(target);
    }
  }, [playTrack]);

  const togglePlayPauseRef = useRef(togglePlayPause);
  const stopRef = useRef(stop);
  const nextTrackRef = useRef(nextTrack);
  const prevTrackRef = useRef(prevTrack);

  useEffect(() => {
    togglePlayPauseRef.current = togglePlayPause;
    stopRef.current = stop;
    nextTrackRef.current = nextTrack;
    prevTrackRef.current = prevTrack;
  });

  // MediaSession Action Handlers: Persistent remote commands for iOS Lockscreen / Control Center / Desktop
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        const audio = audioRef.current;
        if (!isPlayingRef.current || (audio && audio.paused)) {
          togglePlayPauseRef.current();
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        const audio = audioRef.current;
        if (isPlayingRef.current || (audio && !audio.paused)) {
          togglePlayPauseRef.current();
        }
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        stopRef.current();
      });

      // Принудительно отключаем перемотку 15 сек на экране блокировки iOS,
      // чтобы iOS WebKit отображал нативные кнопки переключения треков >>| и |<<
      try {
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
      } catch (_) {}

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        prevTrackRef.current();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        nextTrackRef.current();
      });
      try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime != null && audioRef.current) {
            audioRef.current.currentTime = details.seekTime;
          }
        });
      } catch (_) {}
    } catch (_) {}
  }, [currentTrack, queue, isPlaying]);

  // MediaSession Metadata: Updates station info & artwork when current track changes
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (!currentTrack) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      } catch (_) {}
      return;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: currentTrack.coverUrl ? [
          { src: currentTrack.coverUrl, sizes: '96x96', type: 'image/png' },
          { src: currentTrack.coverUrl, sizes: '256x256', type: 'image/png' },
          { src: currentTrack.coverUrl, sizes: '512x512', type: 'image/png' }
        ] : []
      });
    } catch (_) {}
  }, [currentTrack]);

  // MediaSession Playback State: Reflects playing/paused state on lockscreen without killing the widget
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      // CRITICAL FOR IOS LOCKSCREEN RETENTION:
      // Never pass duration: 0 to setPositionState!
      // In iOS Safari / WebKit, passing duration: 0 informs the OS that playback has finished,
      // which causes iOS MediaRemote to immediately dismiss the lockscreen widget ~1s after pause.
      if ('setPositionState' in navigator.mediaSession) {
        if (currentTrack.type === 'radio') {
          // For live streams, omit position state so iOS displays native "LIVE" indicator
          try {
            navigator.mediaSession.setPositionState();
          } catch (_) {}
        } else {
          const audio = audioRef.current;
          if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              position: Math.min(audio.currentTime, audio.duration),
              playbackRate: isPlaying ? 1 : 0
            });
          }
        }
      }
    } catch (_) {
      // Ignore unsupported browser variations
    }
  }, [isPlaying, currentTrack]);

  // Watchdog Heartbeat: Periodically inspect currentTime to auto-heal truly dead streams without dropping on brief network jitter
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      if (!isPlayingRef.current) return;
      const audio = audioRef.current;
      const track = currentTrackRef.current;
      if (!audio || !track || track.type !== 'radio' || isUserPausedRef.current) {
        return;
      }

      // If audio paused unintentionally (e.g. minor buffer underrun), attempt soft play first
      if (audio.paused) {
        stalledCountRef.current++;
        // Ticks 1-3 (up to 9s): Try soft resume on existing open socket
        if (stalledCountRef.current <= 3) {
          audio.play().catch(() => {});
          return;
        }
        // Only if stuck for >= 12 seconds, trigger a reconnect
        if (stalledCountRef.current >= 4) {
          stalledCountRef.current = 0;
          attemptReconnect('watchdog: audio element paused unexpectedly');
        }
        return;
      }

      const currentTime = audio.currentTime;
      const hasProgressed = Math.abs(currentTime - lastTimeRef.current) >= 0.05;
      const isBufferingGrace = audio.readyState >= 2; // HAVE_CURRENT_DATA or HAVE_ENOUGH_DATA

      if (!hasProgressed && !isBufferingGrace) {
        stalledCountRef.current++;
        // Stalled for >= 12.0 seconds (4 ticks * 3s) without forward progression -> Trigger auto-recovery
        if (stalledCountRef.current >= 4) {
          stalledCountRef.current = 0;
          attemptReconnect('watchdog: stream playback frozen');
        }
      } else {
        stalledCountRef.current = 0;
        lastTimeRef.current = currentTime;
        reconnectAttemptRef.current = 0; // Stream is moving forward reliably
      }
    }, 3000);

    return () => clearInterval(watchdogInterval);
  }, [attemptReconnect]);

  // Background visibility & Tab Focus recovery
  useEffect(() => {
    const handleVisibilityOrFocus = async () => {
      if (isAudioMasterRef.current && !document.hidden && isPlayingRef.current && !isUserPausedRef.current) {
        startBackgroundShield();
        await audioEqualizerManager.resumeContext();
        const audio = audioRef.current;
        if (audio && audio.paused && !isPausedByDeviceRef.current) {
          audio.play().catch(() => {
            attemptReconnect('tab visible resume');
          });
        }
      } else if (!isAudioMasterRef.current && !document.hidden) {
        // When a non-master tab gains focus, refresh its peer state
        broadcastChannelRef.current?.postMessage({
          type: 'PING_MASTER',
          senderId: tabIdRef.current
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [startBackgroundShield, attemptReconnect]);

  // Cross-Window Audio Synchronization via BroadcastChannel & LocalStorage
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('mb_audio_bus');
    broadcastChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<AudioSyncMessage>) => {
      const msg = event.data;
      if (!msg || msg.senderId === tabIdRef.current) return;

      if (msg.type === 'PING_MASTER') {
        if (isAudioMasterRef.current && currentTrackRef.current) {
          channel.postMessage({
            type: 'PONG_MASTER',
            track: currentTrackRef.current,
            isPlaying: isPlayingRef.current,
            isBuffering: false,
            masterId: tabIdRef.current,
            senderId: tabIdRef.current
          });
        }
      } else if (msg.type === 'PONG_MASTER' || msg.type === 'STATE_SYNC') {
        if (!isAudioMasterRef.current) {
          if (msg.track) {
            setCurrentTrack(msg.track);
            setIsPlaying(Boolean(msg.isPlaying));
            setIsBuffering(Boolean(msg.isBuffering));
          } else {
            setCurrentTrack(null);
            setIsPlaying(false);
            setIsBuffering(false);
          }
        }
      } else if (msg.type === 'COMMAND_TOGGLE') {
        if (isAudioMasterRef.current) {
          togglePlayPause();
        }
      } else if (msg.type === 'COMMAND_STOP') {
        stop(true);
      }
    };

    // Clean up any legacy lingering audio state from localStorage to ensure total silence on boot
    try {
      localStorage.removeItem(AUDIO_STORAGE_KEY);
    } catch (_) {}

    // Ping any existing master window (e.g. running radio in background)
    channel.postMessage({
      type: 'PING_MASTER',
      senderId: tabIdRef.current
    });

    return () => {
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, [stop, togglePlayPause]);

  // Resume or reaffirm audio when PWA window is focused via launchQueue or visibility change
  useEffect(() => {
    const handlePwaFocus = async () => {
      if (isAudioMasterRef.current && isPlayingRef.current) {
        startBackgroundShield();
        await audioEqualizerManager.resumeContext();
        const audio = audioRef.current;
        if (audio && audio.paused && !isPausedByDeviceRef.current && !isUserPausedRef.current) {
          audio.play().catch(() => attemptReconnect('pwa focus auto-resume'));
        }
      } else if (!isAudioMasterRef.current) {
        broadcastChannelRef.current?.postMessage({
          type: 'PING_MASTER',
          senderId: tabIdRef.current
        });
      }
    };

    window.addEventListener('pwa-window-focused', handlePwaFocus);
    return () => window.removeEventListener('pwa-window-focused', handlePwaFocus);
  }, [startBackgroundShield, attemptReconnect]);

  // Handle native audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      isPausedByDeviceRef.current = false;
      // Восстанавливаем контекст и накладываем настройки эквалайзера при старте воспроизведения любого трека
      try {
        audioEqualizerManager.reapplySettings();
      } catch (_) {}
    };

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      isPausedByDeviceRef.current = false;
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      stalledCountRef.current = 0;
      try {
        audioEqualizerManager.reapplySettings();
      } catch (_) {}
      if (isAudioMasterRef.current && currentTrackRef.current) {
        syncToPeers(currentTrackRef.current, true, false);
      }
    };

    const onCanPlay = () => {
      setIsBuffering(false);
    };

    const onWaiting = () => {
      setIsBuffering(true);
    };

    const onPause = () => {
      if (isUserPausedRef.current || isRefreshingSrcRef.current) {
        setIsPlaying(false);
        // Do not suspend Web Audio context on pause, keeping audio output pipeline primed for lockscreen unpause
        if (isAudioMasterRef.current && currentTrackRef.current) {
          syncToPeers(currentTrackRef.current, false, false);
        }
      } else {
        // Stream paused due to device disconnect (e.g. Bluetooth turned off) or OS interruption
        isPausedByDeviceRef.current = true;
        setIsPlaying(false);
        setIsBuffering(false);
        audioEqualizerManager.resumeContext();
        if (isAudioMasterRef.current && currentTrackRef.current) {
          syncToPeers(currentTrackRef.current, false, false);
        }
      }
    };

    const onEnded = () => {
      const track = currentTrackRef.current;
      const a = audioRef.current;
      if (track?.type === 'radio') {
        if (!isUserPausedRef.current) {
          console.warn('[Audio] Radio stream ended by server, triggering auto-reconnect...');
          attemptReconnect('stream ended by server');
        } else {
          audioEqualizerManager.suspendContext();
        }
      } else if (track?.type === 'music' && !isUserPausedRef.current) {
        // HTML5 audio 'ended' event fires when the media has naturally finished playing.
        // Guard only against instant aborts (e.g. ended fired within first 3 seconds of a long track).
        const isInstantAbort = a && Number.isFinite(a.duration) && a.duration >= 20 && a.currentTime < 3;
        if (isInstantAbort) {
          console.warn('[Audio] Track ended prematurely at', a?.currentTime, 'of', a?.duration, '— halting runaway skipping');
          setIsPlaying(false);
          setIsBuffering(false);
          if (a && a.currentTime < 10) {
            try {
              trackError('music', track.title || '', String(track.id), 'music_aborted_early');
            } catch (_) {}
          }
        } else {
          nextTrack();
        }
      } else {
        audioEqualizerManager.suspendContext();
      }
    };

    const onError = async () => {
      console.warn('[Audio] Playback error or device disconnect:', audio.error);
      const track = currentTrackRef.current;
      if (track?.type === 'radio') {
        // Пауза по событию устройства/сети: флаг блокирует автопродолжение до действия пользователя,
        // сбрасывается в onPlaying/onPlay и togglePlayPause
        isPausedByDeviceRef.current = true;
        setIsBuffering(true);
        if (!isReconnectingRef.current && !isUserPausedRef.current) {
          attemptReconnect('playback error');
        }
      } else if (track?.type === 'music') {
        setIsPlaying(false);
        // Single automatic re-resolve retry with cache bypass on playback error
        if (track.id && musicRetryTokenRef.current !== track.id) {
          musicRetryTokenRef.current = track.id;
          console.warn(`[Audio] Retrying music playback for ${track.artist} - ${track.title} with bypassCache...`);
          setIsBuffering(true);
          const myToken = ++musicResolveRef.current;
          await startMusicTrack(track, audio, myToken, true /* bypassCache */);
          return;
        }
        setIsBuffering(false);
        isPausedByDeviceRef.current = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('music-track-unavailable', {
            detail: { title: track.title, artist: track.artist, id: track.id }
          }));
        }
        try {
          trackError('music', track.title || '', String(track.id), 'playback_error');
        } catch (_) {}
      } else {
        setIsPlaying(false);
        setIsBuffering(false);
        isPausedByDeviceRef.current = true;
      }
    };

    const onStalled = () => {
      if (currentTrackRef.current?.type === 'radio' && isPlayingRef.current && !isUserPausedRef.current && !audio.paused) {
        // Fast buffer rescue on stall
        setIsBuffering(true);
      }
    };

    const onTimeUpdate = () => {
      const a = audioRef.current;
      const track = currentTrackRef.current;
      if (!a || !track) return;

      // Автоматическое восстановление контекста WebKit, если таймлайн бежит при заблокированном выводе
      if (!a.paused && audioEqualizerManager.isSuspendedOrInterrupted()) {
        audioEqualizerManager.resumeContext();
      }

      if (track.type === 'radio' || !('mediaSession' in navigator)) return;
      if (Number.isFinite(a.duration) && a.duration > 0 && 'setPositionState' in navigator.mediaSession) {
        try {
          navigator.mediaSession.setPositionState({
            duration: a.duration,
            position: Math.min(a.currentTime, a.duration),
            playbackRate: a.paused ? 0 : 1
          });
        } catch (_) {}
      }
    };

    // Online/Offline handlers
    const onOffline = () => {
      console.warn('[Network] Went offline');
      if (currentTrackRef.current?.type === 'radio') {
        setIsBuffering(true);
      }
    };

    const onOnline = () => {
      const track = currentTrackRef.current;
      if (track?.type === 'radio' && !isUserPausedRef.current) {
        reconnectAttemptRef.current = 0;
        attemptReconnect('network back online');
      }
    };

    // Обработка смены аудиоустройства (подключение/отключение Bluetooth-гарнитуры или наушников)
    const onDeviceChange = () => {
      console.log('[Audio] Audio output device changed (Bluetooth/headphones)');
      const track = currentTrackRef.current;
      const audio = audioRef.current;
      if (!track || !audio || isUserPausedRef.current) return;

      // При смене аудиомаршрута синхронизируем сессию и восстанавливаем контекст эквалайзера
      startBackgroundShield();
      audioEqualizerManager.resumeContext();

      // Если аудиоэлемент ушел в ошибку из-за смены звукового тракта ядра, мягко восстанавливаем источник
      if (audio.error) {
        const rawUrl = track.originalUrl || track.url;
        isRefreshingSrcRef.current = true;
        audio.src = rawUrl;
        audio.load();
        isRefreshingSrcRef.current = false;
      }
    };

    // Разблокировка Web Audio контекста при любом касании экрана / клике пользователя
    const handleUserInteraction = () => {
      if (audioEqualizerManager.isSuspendedOrInterrupted()) {
        audioEqualizerManager.resumeContext();
      }
    };
    window.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });

    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    }

    return () => {
      window.removeEventListener('pointerdown', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (navigator.mediaDevices) {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      }
    };
  }, [currentTrack, attemptReconnect, togglePlayPause, nextTrack]);

  return (
    <AudioPlayerContext.Provider value={{ currentTrack, isPlaying, isBuffering, queue, isShuffle, toggleShuffle, setQueue: updateQueue, playTrack, togglePlayPause, nextTrack, prevTrack, stop, audioRef }}>
      {children}
      <audio ref={audioRef} preload="auto" playsInline crossOrigin="anonymous" />
    </AudioPlayerContext.Provider>
  );
}

export const useAudioPlayer = () => {
  const context = useContext(AudioPlayerContext);
  if (!context) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return context;
};

