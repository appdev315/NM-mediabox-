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
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
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
        // Native Apple Hardware HLS (Safari / macOS / iOS) — ~0% CPU, hardware DSP audio decoding
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
                console.warn('[HLS] Network error encountered, attempting automatic recovery...');
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn('[HLS] Media error encountered, attempting automatic recovery...');
                hls.recoverMediaError();
                break;
              default:
                console.error('[HLS] Fatal unrecoverable error, destroying instance');
                stop();
                break;
            }
          }
        });
      } else {
        audio.src = url;
      }
    } else {
      audio.src = url;
    }

    audio.load();
    audio.play().catch(() => setIsBuffering(false));
    setIsPlaying(true);
  }, [togglePlayPause, stop]); // togglePlayPause is stable (no deps)

  // MediaSession — separate effect so handlers always use latest refs
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      artwork: currentTrack.coverUrl ? [{ src: currentTrack.coverUrl, sizes: '512x512' }] : []
    });

    navigator.mediaSession.setActionHandler('play', () => {
      audioRef.current?.play().catch(() => { });
      setIsPlaying(true);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause();
      setIsPlaying(false);
    });
    navigator.mediaSession.setActionHandler('stop', () => stop());
  }, [currentTrack, stop]);

  // Handle native audio events, reconnect logic, heartbeat
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // --- Reconnect state ---
    let reconnectAttempt = 0;
    const MAX_RECONNECT = 5; // Increased max retries for background stability

    const attemptReconnect = (reason: string) => {
      const track = currentTrackRef.current;
      if (!track || track.type !== 'radio') return;
      if (reconnectAttempt >= MAX_RECONNECT) {
        console.error(`[Radio] Max reconnect reached (${reason}), giving up`);
        setIsPlaying(false);
        setIsBuffering(false);
        return;
      }

      reconnectAttempt++;
      console.warn(`[Radio] ${reason} — reconnect ${reconnectAttempt}/${MAX_RECONNECT} (Synchronous)`);
      setIsBuffering(true);

      // SYNCHRONOUS RECONNECT: 
      // Do NOT use setTimeout here. If the screen is off, the OS will suspend JS 
      // when the audio stops. By reconnecting synchronously, we keep the audio session alive.
      const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
      const baseUrl = track.url;
      const url = (!isHls) 
        ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`
        : baseUrl;

      if (isHls && hlsRef.current) {
        hlsRef.current.loadSource(url);
        audio.play().catch((err) => {
          console.error('[Radio] Hls reconnect play failed:', err);
          if (err.name !== 'NotAllowedError') {
            setIsBuffering(false);
            setIsPlaying(false);
          }
        });
      } else {
        audio.src = url;
        audio.load();
        audio.play().catch((err) => {
          console.error('[Radio] Sync reconnect failed:', err);
          if (err.name !== 'NotAllowedError') {
            setIsBuffering(false);
            setIsPlaying(false);
          }
        });
      }
    };

    // --- Event handlers ---
    const onPlay = () => setIsPlaying(true);
    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      reconnectAttempt = 0; // Reset on successful playback
    };
    const onWaiting = () => setIsBuffering(true);
    const onPause = () => {
      // If the user didn't explicitly pause, but the audio paused (e.g. system interruption, screen lock)
      // we try to force it back to playing immediately to prevent background suspension.
      if (!isUserPausedRef.current && currentTrackRef.current?.type === 'radio') {
        console.warn('[Radio] System paused audio, forcing resume...');
        audio.play().catch(() => setIsPlaying(false));
      } else {
        setIsPlaying(false);
      }
    };

    const onError = () => {
      console.error('[Audio] Playback error');
      // For radio: try reconnect with exponential backoff
      if (currentTrackRef.current?.type === 'radio') {
        attemptReconnect('playback error');
      } else {
        setIsPlaying(false);
        setIsBuffering(false);
      }
    };

    const onStalled = () => {
      // Browsers often fire 'stalled' even when playback is fine or can recover seamlessly.
      // Forcefully reconnecting here causes immediate audio interruptions for the user.
      // We rely on the 15-second heartbeat to detect actual dead streams instead.
      console.warn('[Audio] Stream stalled but allowing browser to recover natively.');
    };

    // --- Online/Offline handlers ---
    const onOffline = () => {
      console.warn('[Network] Went offline');
      // Don't stop — just mark buffering. Will auto-resume when online.
      if (currentTrackRef.current?.type === 'radio') {
        setIsBuffering(true);
      }
    };

    const onOnline = () => {
      console.log('[Network] Back online, refreshing live radio stream...');
      const track = currentTrackRef.current;
      if (track?.type === 'radio' && isPlayingRef.current) {
        reconnectAttempt = 0;
        const isHls = track.url.includes('.m3u8') || track.url.includes('/playlist');
        const freshUrl = !isHls 
          ? `${track.url}${track.url.includes('?') ? '&' : '?'}cb=${Date.now()}`
          : track.url;
        audio.pause();
        audio.src = freshUrl;
        audio.load();
        audio.play().catch(() => { });
      }
    };

    // --- Heartbeat: detect frozen radio streams ---
    let lastCurrentTime = 0;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    if (currentTrackRef.current?.type === 'radio') {
      heartbeatInterval = setInterval(() => {
        if (document.hidden) return; // Allow macOS Safari App Nap power savings
        if (!currentTrackRef.current || currentTrackRef.current.type !== 'radio') return;
        if (!isPlayingRef.current || audio.paused) return;

        // If currentTime hasn't advanced in 20 seconds, stream is frozen
        if (audio.currentTime > 0 && audio.currentTime === lastCurrentTime) {
          console.warn('[Radio] Heartbeat: stream frozen, reconnecting...');
          attemptReconnect('heartbeat: frozen stream');
        }
        lastCurrentTime = audio.currentTime;
      }, 20000);
    }

    // --- Register listeners ---
    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    };
  }, [currentTrack]); // Re-attach when track changes to reset heartbeat & reconnect state

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
