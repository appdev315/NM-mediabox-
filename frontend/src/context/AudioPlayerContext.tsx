import React, { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';

export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  coverUrl?: string;
  type?: 'radio';
}

interface AudioPlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  playTrack: (track: Track) => void;
  togglePlayPause: () => void;
  stop: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined);

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Refs to always hold the latest state — avoids stale closures
  const isPlayingRef = useRef(isPlaying);
  const currentTrackRef = useRef(currentTrack);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);

  // Stable callbacks that read from refs instead of captured state
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setIsPlaying(false);
    setCurrentTrack(null);
  }, []);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackRef.current) return;

    if (isPlayingRef.current) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
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
    setCurrentTrack(track);
    audio.src = track.url;
    audio.load();
    audio.play().catch(() => {});
    setIsPlaying(true);
  }, [togglePlayPause]); // togglePlayPause is stable (no deps)

  // MediaSession — separate effect so handlers always use latest refs
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      artwork: currentTrack.coverUrl ? [{ src: currentTrack.coverUrl, sizes: '512x512' }] : []
    });

    navigator.mediaSession.setActionHandler('play', () => {
      audioRef.current?.play().catch(() => {});
      setIsPlaying(true);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause();
      setIsPlaying(false);
    });
    navigator.mediaSession.setActionHandler('stop', () => stop());
  }, [currentTrack, stop]);

  // Handle native audio events (e.g. stream ends, buffering errors)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      // Only set isPlaying false if it wasn't a transient system interruption
      // (e.g. iOS suspends audio briefly on app switch). Give it a moment.
      // If audio resumes within 300ms, ignore the pause.
      const timer = setTimeout(() => {
        if (audio.paused) setIsPlaying(false);
      }, 300);
      return () => clearTimeout(timer);
    };
    const onError = () => {
      console.error('Audio playback error');
      setIsPlaying(false);
    };
    // Auto-retry on stall (radio streams can hiccup)
    const onStalled = () => {
      if (currentTrackRef.current?.type === 'radio') {
        console.warn('Radio stream stalled, attempting reconnect...');
        const src = audio.src;
        if (src) {
          audio.src = src;
          audio.load();
          audio.play().catch(() => {});
        }
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
    };
  }, []);

  return (
    <AudioPlayerContext.Provider value={{ currentTrack, isPlaying, playTrack, togglePlayPause, stop, audioRef }}>
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
