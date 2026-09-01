import React, { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import Hls from 'hls.js';
import { EXPRESS_API_BASE } from '../hooks/useApi';

export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  coverUrl?: string;
  type?: 'radio';
  originalUrl?: string; // Original URL for fallback if proxied URL fails
}

interface AudioPlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  playTrack: (track: Track) => void;
  togglePlayPause: () => void;
  stop: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined);

// Dynamic Network Information helper
const getOptimalBufferConfig = () => {
  const conn = (navigator as any).connection;
  const effectiveType = conn?.effectiveType || '4g';
  switch (effectiveType) {
    case 'slow-2g':
    case '2g':
      return { maxBufferLength: 120, maxMaxBufferLength: 240, backBufferLength: 15 };
    case '3g':
      return { maxBufferLength: 90, maxMaxBufferLength: 180, backBufferLength: 15 };
    default:
      return { maxBufferLength: 60, maxMaxBufferLength: 180, backBufferLength: 15 };
  }
};

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isUserPausedRef = useRef(false); // Track if user explicitly clicked pause
  const hlsRef = useRef<Hls | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastTimeRef = useRef(0);
  const stalledCountRef = useRef(0);

  // Refs to always hold the latest state — avoids stale closures
  const isPlayingRef = useRef(isPlaying);
  const currentTrackRef = useRef(currentTrack);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);

  // Mobile Keep-Alive: Inaudible 20Hz Web Audio oscillator prevents OS suspension
  const ensureAudioContextKeepAlive = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.00001; // Silent inaudible carrier
        osc.frequency.value = 20;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        audioContextRef.current = ctx;
      } else if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    } catch (e) {
      // Ignore browsers without Web Audio support
    }
  }, []);

  // Stable callbacks that read from refs instead of captured state
  const stop = useCallback(() => {
    isUserPausedRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTrack(null);
  }, []);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (!audio || !track) return;

    if (isPlayingRef.current) {
      isUserPausedRef.current = true;
      audio.pause();
      setIsPlaying(false);
      setIsBuffering(false);
    } else {
      isUserPausedRef.current = false;
      setIsBuffering(true);
      ensureAudioContextKeepAlive();

      if (track.type === 'radio') {
        const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
        if (isHls && hlsRef.current) {
          hlsRef.current.startLoad();
          audio.play().then(() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }).catch(() => {
            setIsBuffering(false);
          });
        } else {
          // Reconnect to live edge upon unpause to avoid dead TCP socket
          const baseUrl = track.url.split('&_t=')[0].split('?_t=')[0];
          const freshUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
          audio.src = freshUrl;
          audio.load();
          audio.play().then(() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }).catch(() => {
            setIsBuffering(false);
          });
        }
      } else {
        audio.play().then(() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }).catch(() => {
          setIsBuffering(false);
        });
      }
    }
  }, [ensureAudioContextKeepAlive]);

  const attemptReconnect = useCallback((reason: string) => {
    const track = currentTrackRef.current;
    const audio = audioRef.current;
    if (!track || !audio || track.type !== 'radio' || isUserPausedRef.current) return;
    if (isReconnectingRef.current) return;

    isReconnectingRef.current = true;
    reconnectAttemptRef.current++;
    setIsBuffering(true);
    console.warn(`[Radio] ${reason} — reconnect attempt #${reconnectAttemptRef.current}`);

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    // Exponential backoff with random Jitter to prevent thundering herd
    const jitter = (Math.random() - 0.5) * 300;
    const baseBackoff = Math.min(4000, 400 * Math.pow(1.3, reconnectAttemptRef.current - 1));
    const backoffMs = Math.max(250, baseBackoff + jitter);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isUserPausedRef.current) {
        isReconnectingRef.current = false;
        return;
      }

      // Fast failover: Switch to Go proxy immediately on attempt 1 if direct stream dropped
      let targetUrl = track.url;
      if (reconnectAttemptRef.current >= 1 && !targetUrl.includes('/proxy')) {
        const rawUrl = track.originalUrl || track.url;
        targetUrl = `${EXPRESS_API_BASE}/proxy?url=${encodeURIComponent(rawUrl)}`;
        console.log('[Radio] Switching to Go proxy stream fallback:', targetUrl);
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
        });
      } else {
        audio.src = freshUrl;
        audio.load();
        audio.play().then(() => {
          isReconnectingRef.current = false;
          setIsBuffering(false);
          setIsPlaying(true);
        }).catch(() => {
          isReconnectingRef.current = false;
        });
      }
    }, backoffMs);
  }, []);

  const playTrack = useCallback((track: Track) => {
    const audio = audioRef.current;
    if (!audio) return;

    // If same track, toggle play/pause
    if (currentTrackRef.current?.id === track.id) {
      togglePlayPause();
      return;
    }

    // New track
    ensureAudioContextKeepAlive();
    isUserPausedRef.current = false;
    reconnectAttemptRef.current = 0;
    isReconnectingRef.current = false;
    stalledCountRef.current = 0;
    lastTimeRef.current = 0;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setCurrentTrack(track);
    setIsBuffering(true);

    // Clean up previous Hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    audio.preload = track.type === 'radio' ? 'auto' : 'none';
    
    const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
    const url = track.url;
      
    if (isHls) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = url;
      } else if (Hls.isSupported()) {
        const bufferCfg = getOptimalBufferConfig();
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: bufferCfg.maxBufferLength,
          maxMaxBufferLength: bufferCfg.maxMaxBufferLength,
          backBufferLength: bufferCfg.backBufferLength,
          maxBufferHole: 0.5,
          startFragPrefetch: true,
          maxBufferSize: 60 * 1024 * 1024,
          liveSyncDuration: 3,
          liveMaxLatencyDuration: 10,
          manifestLoadingMaxRetry: 10,
          levelLoadingMaxRetry: 10,
          fragLoadingMaxRetry: 10,
          maxFragLookUpTolerance: 0.25,
        });
        hls.loadSource(url);
        hls.attachMedia(audio);
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.warn('[HLS] Network error encountered, attempting recovery...');
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn('[HLS] Media error encountered, recovering media...');
                hls.recoverMediaError();
                break;
              default:
                console.error('[HLS] Fatal error, delegating to attemptReconnect...');
                attemptReconnect('hls fatal error');
                break;
            }
          }
        });
      } else {
        audio.src = url;
        audio.load();
      }
    } else {
      audio.src = url;
      audio.load();
    }

    audio.play().catch(() => setIsBuffering(false));
    setIsPlaying(true);
  }, [attemptReconnect, togglePlayPause, ensureAudioContextKeepAlive]);

  // MediaSession v2 handler (Live stream status & background lockscreen)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      artwork: currentTrack.coverUrl ? [
        { src: currentTrack.coverUrl, sizes: '96x96', type: 'image/png' },
        { src: currentTrack.coverUrl, sizes: '256x256', type: 'image/png' },
        { src: currentTrack.coverUrl, sizes: '512x512', type: 'image/png' }
      ] : []
    });

    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: 0,
          position: 0,
          playbackRate: 1
        });
      }
    } catch (_) {
      // Ignore unsupported browser variations
    }

    navigator.mediaSession.setActionHandler('play', () => {
      if (!isPlayingRef.current) {
        togglePlayPause();
      }
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (isPlayingRef.current) {
        togglePlayPause();
      }
    });
    navigator.mediaSession.setActionHandler('stop', () => stop());
  }, [currentTrack, isPlaying, stop, togglePlayPause]);

  // Watchdog Heartbeat: Periodically inspect currentTime to auto-heal frozen streams
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      const audio = audioRef.current;
      const track = currentTrackRef.current;
      if (!audio || !track || track.type !== 'radio' || isUserPausedRef.current || !isPlayingRef.current) {
        return;
      }

      const currentTime = audio.currentTime;
      if (Math.abs(currentTime - lastTimeRef.current) < 0.05) {
        stalledCountRef.current++;
        // Stalled for >= 5.0 seconds without forward progression -> Trigger auto-recovery
        if (stalledCountRef.current >= 2) {
          stalledCountRef.current = 0;
          attemptReconnect('watchdog: stream playback frozen');
        }
      } else {
        stalledCountRef.current = 0;
        lastTimeRef.current = currentTime;
        reconnectAttemptRef.current = 0; // Stream is moving forward reliably
      }
    }, 2500);

    return () => clearInterval(watchdogInterval);
  }, [attemptReconnect]);

  // Background visibility & Tab Focus recovery
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (!document.hidden && isPlayingRef.current && !isUserPausedRef.current) {
        ensureAudioContextKeepAlive();
        const audio = audioRef.current;
        if (audio && audio.paused) {
          audio.play().catch(() => {
            attemptReconnect('tab visible resume');
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [ensureAudioContextKeepAlive, attemptReconnect]);

  // Handle native audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
    };

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      stalledCountRef.current = 0;
    };

    const onCanPlay = () => {
      setIsBuffering(false);
    };

    const onWaiting = () => {
      setIsBuffering(true);
    };

    const onPause = () => {
      if (isUserPausedRef.current) {
        setIsPlaying(false);
      }
    };

    const onEnded = () => {
      console.warn('[Audio] Stream ended by server, triggering auto-reconnect...');
      if (currentTrackRef.current?.type === 'radio' && !isUserPausedRef.current) {
        attemptReconnect('stream ended by server');
      }
    };

    const onError = () => {
      console.error('[Audio] Playback error');
      if (currentTrackRef.current?.type === 'radio') {
        if (!isReconnectingRef.current && !isUserPausedRef.current) {
          attemptReconnect('playback error');
        }
      } else {
        setIsPlaying(false);
        setIsBuffering(false);
      }
    };

    const onStalled = () => {
      if (currentTrackRef.current?.type === 'radio' && isPlayingRef.current && !isUserPausedRef.current) {
        // Fast buffer rescue on stall
        setIsBuffering(true);
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
      console.log('[Network] Back online, refreshing live radio stream...');
      const track = currentTrackRef.current;
      if (track?.type === 'radio' && isPlayingRef.current && !isUserPausedRef.current) {
        reconnectAttemptRef.current = 0;
        attemptReconnect('network back online');
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [currentTrack, attemptReconnect]);

  return (
    <AudioPlayerContext.Provider value={{ currentTrack, isPlaying, isBuffering, playTrack, togglePlayPause, stop, audioRef }}>
      {children}
      <audio ref={audioRef} preload="auto" playsInline />
    </AudioPlayerContext.Provider>
  );
}

export const useAudioPlayer = () => {
  const context = useContext(AudioPlayerContext);
  if (!context) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return context;
};

