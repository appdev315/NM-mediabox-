import React, { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import Hls from 'hls.js';

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

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isUserPausedRef = useRef(false); // Track if user explicitly clicked pause
  const hlsRef = useRef<Hls | null>(null);

  // Refs to always hold the latest state — avoids stale closures
  const isPlayingRef = useRef(isPlaying);
  const currentTrackRef = useRef(currentTrack);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);

  // Stable callbacks that read from refs instead of captured state
  const stop = useCallback(() => {
    isUserPausedRef.current = true;
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
    if (!audio || !currentTrackRef.current) return;

    if (isPlayingRef.current) {
      isUserPausedRef.current = true;
      audio.pause();
      setIsPlaying(false);
    } else {
      isUserPausedRef.current = false;
      audio.play().catch(() => { });
      setIsPlaying(true);
    }
  }, []); // No deps — reads from refs

  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);

  const attemptReconnect = useCallback((reason: string) => {
    const track = currentTrackRef.current;
    const audio = audioRef.current;
    if (!track || !audio || track.type !== 'radio' || isUserPausedRef.current) return;
    if (isReconnectingRef.current) return;

    isReconnectingRef.current = true;
    reconnectAttemptRef.current++;
    console.warn(`[Radio] ${reason} — reconnect attempt #${reconnectAttemptRef.current}`);
    setIsBuffering(true);

    const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
    const baseUrl = track.url;
    const url = (!isHls) 
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`
      : baseUrl;

    if (isHls && hlsRef.current) {
      hlsRef.current.loadSource(url);
      audio.play().then(() => {
        isReconnectingRef.current = false;
      }).catch((err) => {
        isReconnectingRef.current = false;
        console.error('[Radio] Hls reconnect play failed:', err);
        if (err.name !== 'NotAllowedError') {
          setIsBuffering(false);
        }
      });
    } else {
      audio.src = url;
      audio.load();
      audio.play().then(() => {
        isReconnectingRef.current = false;
      }).catch((err) => {
        isReconnectingRef.current = false;
        console.error('[Radio] Sync reconnect failed:', err);
        if (err.name !== 'NotAllowedError') {
          setIsBuffering(false);
        }
      });
    }
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
    isUserPausedRef.current = false;
    reconnectAttemptRef.current = 0;
    setCurrentTrack(track);
    setIsBuffering(true);

    // Clean up previous Hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Use preload="auto" for radio for bigger buffer
    audio.preload = track.type === 'radio' ? 'auto' : 'none';
    
    const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
    const url = track.url;
      
    if (isHls) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Apple Hardware HLS (Safari / macOS / iOS)
        audio.src = url;
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          maxBufferSize: 30 * 1024 * 1024,
          backBufferLength: 30,
          manifestLoadingMaxRetry: 5,
          levelLoadingMaxRetry: 5,
          fragLoadingMaxRetry: 6,
        });
        hls.loadSource(url);
        hls.attachMedia(audio);
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.warn('[HLS] Network error encountered, delegating to attemptReconnect...');
                attemptReconnect('hls network error');
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
  }, [attemptReconnect, togglePlayPause]);

  // MediaSession — separate effect with explicit user-pause tracking
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      artwork: currentTrack.coverUrl ? [{ src: currentTrack.coverUrl, sizes: '512x512' }] : []
    });

    navigator.mediaSession.setActionHandler('play', () => {
      isUserPausedRef.current = false;
      audioRef.current?.play().catch(() => { });
      setIsPlaying(true);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      isUserPausedRef.current = true;
      audioRef.current?.pause();
      setIsPlaying(false);
    });
    navigator.mediaSession.setActionHandler('stop', () => stop());
  }, [currentTrack, stop]);

  // Handle native audio events, reconnect logic, and frozen stream watchdog
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let lastProgressTime = Date.now();

    // --- Event handlers ---
    const onPlay = () => {
      setIsPlaying(true);
      lastProgressTime = Date.now();
    };

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      reconnectAttemptRef.current = 0; // Reset backoff on successful stream playback
      lastProgressTime = Date.now();
    };

    const onTimeUpdate = () => {
      lastProgressTime = Date.now();
    };

    const onWaiting = () => {
      setIsBuffering(true);
      lastProgressTime = Date.now(); // Do not trigger freeze during buffering
    };

    const onPause = () => {
      if (!isUserPausedRef.current && currentTrackRef.current?.type === 'radio') {
        console.warn('[Radio] System paused audio, resuming...');
        audio.play().catch(() => setIsPlaying(false));
      } else {
        setIsPlaying(false);
      }
    };

    const onError = () => {
      console.error('[Audio] Playback error');
      if (currentTrackRef.current?.type === 'radio') {
        attemptReconnect('playback error');
      } else {
        setIsPlaying(false);
        setIsBuffering(false);
      }
    };

    const onStalled = () => {
      console.warn('[Audio] Stream stalled, allowing native buffer fill.');
    };

    // --- Online/Offline handlers ---
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

    // --- Watchdog: detect truly frozen streams without false positives ---
    const watchdogInterval = setInterval(() => {
      if (document.hidden) return; // Ignore when tab/app is in background power saving
      if (!currentTrackRef.current || currentTrackRef.current.type !== 'radio') return;
      if (!isPlayingRef.current || audio.paused || isUserPausedRef.current) return;

      // If playing but no timeupdate/progress for over 25 seconds and not buffering
      const elapsed = Date.now() - lastProgressTime;
      if (elapsed > 25000) {
        console.warn('[Radio] Watchdog: stream frozen for >25s, reconnecting...');
        lastProgressTime = Date.now();
        attemptReconnect('watchdog: stream frozen');
      }
    }, 5000);

    // --- Register listeners ---
    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(watchdogInterval);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [currentTrack]); // Re-attach when track changes to reset reconnect state

  return (
    <AudioPlayerContext.Provider value={{ currentTrack, isPlaying, isBuffering, playTrack, togglePlayPause, stop, audioRef }}>
      {children}
      <audio ref={audioRef} preload="none" playsInline />
    </AudioPlayerContext.Provider>
  );
}

export const useAudioPlayer = () => {
  const context = useContext(AudioPlayerContext);
  if (!context) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return context;
};
