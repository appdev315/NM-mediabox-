import React, { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useHlsPlayer } from '../hooks/useHlsPlayer';
import { EXPRESS_API_BASE } from '../hooks/useApi';
import { trackError } from '../utils/analytics';

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

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isUserPausedRef = useRef(false); // Track if user explicitly clicked pause in UI
  const isPausedByDeviceRef = useRef(false); // Track if paused by headphone removal or OS audio focus
  const { hlsRef, initHls, destroyHls } = useHlsPlayer();
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const lastTimeRef = useRef(0);
  const stalledCountRef = useRef(0);
  const isRefreshingSrcRef = useRef(false);
  const lastPauseTimeRef = useRef(0);

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

  // Mobile Keep-Alive: Inaudible 20Hz Web Audio oscillator prevents OS suspension during active playback
  const ensureAudioContextKeepAlive = useCallback((force = false) => {
    if (!force && (!isPlayingRef.current || !currentTrackRef.current)) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.00001; // Silent inaudible carrier
        osc.frequency.value = 20;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        oscillatorRef.current = osc;
        audioContextRef.current = ctx;
      } else if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    } catch (e) {
      // Ignore browsers without Web Audio support
    }
  }, []);

  // Stable callbacks that read from refs instead of captured state
  const stop = useCallback((fromRemote: boolean | unknown = false) => {
    const isRemote = fromRemote === true;
    isUserPausedRef.current = true;
    isPausedByDeviceRef.current = false;
    isAudioMasterRef.current = false;

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

    // 4. Unconditionally pause, clear src, and unload the audio element
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    // 5. Clean up Web Audio keep-alive oscillator to immediately release soundcard & tab speaker icon
    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
      } catch (_) {}
      oscillatorRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch (_) {}
      audioContextRef.current = null;
    }

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
      // Only tear down audio on unmount if this window is the active audio master
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
      // Only fallback to proxy if stream is insecure HTTP (mixed-content block) and failed repeatedly.
      const rawUrl = track.originalUrl || track.url;
      let targetUrl = rawUrl;
      if (reconnectAttemptRef.current >= 4 && rawUrl.startsWith('http://') && !targetUrl.includes('/proxy')) {
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
      try {
        broadcastChannelRef.current?.postMessage({
          type: 'COMMAND_TOGGLE',
          senderId: tabIdRef.current
        });
      } catch (_) {}
      setIsPlaying(prev => !prev);
      return;
    }

    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (!audio || !track) return;

    if (isPlayingRef.current) {
      isUserPausedRef.current = true;
      lastPauseTimeRef.current = Date.now();
      isPausedByDeviceRef.current = false;
      audio.pause();
      // Suspend Web Audio keep-alive when paused so speaker icon turns off
      if (audioContextRef.current && audioContextRef.current.state === 'running') {
        audioContextRef.current.suspend().catch(() => {});
      }
      setIsPlaying(false);
      setIsBuffering(false);
      syncToPeers(track, false, false);
    } else {
      isUserPausedRef.current = false;
      isPausedByDeviceRef.current = false;
      setIsBuffering(true);
      ensureAudioContextKeepAlive();

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
        }).catch(() => {
          setIsBuffering(false);
        });
      }
    }
  }, [ensureAudioContextKeepAlive, syncToPeers, attemptReconnect]);

  const playTrack = useCallback(async (track: Track) => {
    // If same track, toggle play/pause
    if (currentTrackRef.current?.id === track.id) {
      togglePlayPause();
      return;
    }

    // Stop playback in any other open window/tab to prevent dual streams
    try {
      broadcastChannelRef.current?.postMessage({
        type: 'COMMAND_STOP',
        senderId: tabIdRef.current
      });
    } catch (_) {}

    isAudioMasterRef.current = true;

    const audio = audioRef.current;
    if (!audio) return;

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
    syncToPeers(track, true, true);

    // Clean up previous Hls instance
    destroyHls();

    audio.preload = track.type === 'radio' ? 'auto' : 'none';
    
    const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
    const url = track.url;
      
    if (isHls) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        isRefreshingSrcRef.current = true;
        audio.src = url;
        isRefreshingSrcRef.current = false;
      } else {
        const bufferCfg = getOptimalBufferConfig();
        const hls = await initHls({
          url,
          media: audio,
          config: {
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
          audio.src = url;
          audio.load();
          isRefreshingSrcRef.current = false;
        }
      }
    } else {
      isRefreshingSrcRef.current = true;
      audio.src = url;
      audio.load();
      isRefreshingSrcRef.current = false;
    }

    audio.play().then(() => {
      setIsPlaying(true);
      setIsBuffering(false);
      syncToPeers(track, true, false);
    }).catch((err) => {
      console.warn('[Audio] playTrack error, delegating to attemptReconnect:', err);
      setIsBuffering(false);
      attemptReconnect('playTrack play error');
    });
    setIsPlaying(true);
  }, [attemptReconnect, togglePlayPause, ensureAudioContextKeepAlive, syncToPeers]);

  // MediaSession Action Handlers: Persistent remote commands for iOS Lockscreen / Control Center / Desktop
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    try {
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
      navigator.mediaSession.setActionHandler('stop', () => {
        stop();
      });
    } catch (_) {}

    return () => {
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.setActionHandler('stop', null);
        } catch (_) {}
      }
    };
  }, [togglePlayPause, stop]);

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
    const handleVisibilityOrFocus = () => {
      if (isAudioMasterRef.current && !document.hidden && isPlayingRef.current && !isUserPausedRef.current) {
        ensureAudioContextKeepAlive();
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
  }, [ensureAudioContextKeepAlive, attemptReconnect]);

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
    const handlePwaFocus = () => {
      if (isAudioMasterRef.current && isPlayingRef.current) {
        ensureAudioContextKeepAlive();
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
  }, [ensureAudioContextKeepAlive, attemptReconnect]);

  // Handle native audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      isPausedByDeviceRef.current = false;
    };

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      isPausedByDeviceRef.current = false;
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      stalledCountRef.current = 0;
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
        if (isAudioMasterRef.current && currentTrackRef.current) {
          syncToPeers(currentTrackRef.current, false, false);
        }
      } else {
        // Stream paused due to buffer underrun, device interruption, or packet delay
        // Do NOT drop the TCP stream immediately! Set buffering state and attempt soft resume
        setIsBuffering(true);
        setTimeout(() => {
          const a = audioRef.current;
          if (a && a.paused && !isUserPausedRef.current && isPlayingRef.current) {
            a.play().catch(() => {});
          }
        }, 600);
      }
    };

    const onEnded = () => {
      console.warn('[Audio] Stream ended by server, triggering auto-reconnect...');
      if (currentTrackRef.current?.type === 'radio' && !isUserPausedRef.current) {
        attemptReconnect('stream ended by server');
      }
    };

    const onError = () => {
      console.warn('[Audio] Playback error or device disconnect:', audio.error);
      if (currentTrackRef.current?.type === 'radio') {
        // Mark device pause flag so onDeviceChange knows to resume seamlessly
        isPausedByDeviceRef.current = true;
        setIsBuffering(true);
        if (!isReconnectingRef.current && !isUserPausedRef.current) {
          attemptReconnect('playback error');
        }
      } else {
        setIsPlaying(false);
        setIsBuffering(false);
      }
    };

    const onStalled = () => {
      if (currentTrackRef.current?.type === 'radio' && isPlayingRef.current && !isUserPausedRef.current && !audio.paused) {
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
      const track = currentTrackRef.current;
      if (track?.type === 'radio' && !isUserPausedRef.current) {
        reconnectAttemptRef.current = 0;
        attemptReconnect('network back online');
      }
    };

    // Auto-resume when Bluetooth headphones or audio output devices reconnect
    const onDeviceChange = () => {
      console.log('[Audio] Audio output device changed (Bluetooth/headphones)');
      const track = currentTrackRef.current;
      const audio = audioRef.current;
      if (!track || !audio || isUserPausedRef.current) return;

      // Re-engage Web Audio keep-alive oscillator for newly connected audio device
      ensureAudioContextKeepAlive(true);

      isPausedByDeviceRef.current = false;
      reconnectAttemptRef.current = 0; // Reset retry counter on physical device reconnection
      setIsBuffering(true);

      // If audio element encountered a pipeline error while headphones were disconnected, clear and reload
      if (audio.error) {
        const rawUrl = track.originalUrl || track.url;
        isRefreshingSrcRef.current = true;
        audio.src = rawUrl;
        audio.load();
        isRefreshingSrcRef.current = false;
      }

      audio.play().then(() => {
        setIsPlaying(true);
        setIsBuffering(false);
        syncToPeers(track, true, false);
      }).catch((err) => {
        console.warn('[Audio] Device change play failed, triggering soft reconnect:', err);
        attemptReconnect('device change resume');
      });
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
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    }

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
      if (navigator.mediaDevices) {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      }
    };
  }, [currentTrack, attemptReconnect, togglePlayPause]);

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

