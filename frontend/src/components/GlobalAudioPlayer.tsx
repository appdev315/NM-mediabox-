import { useState, useEffect, memo } from 'react';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLanguage } from '../context/LanguageContext';
import { favoritesManager } from '../utils/favoritesManager';
import { audioOfflineManager } from '../utils/audioOfflineManager';
import { WebApp } from '../telegram';
import { EqualizerModal } from './EqualizerModal';
import type { RefObject } from 'react';

// Isolated scrubber: timeupdate ticks (~4/s) re-render only this subtree,
// not the whole mini-player / card sheet.
const AudioProgressBar = memo(function AudioProgressBar({ audioRef }: { audioRef: RefObject<HTMLAudioElement | null> }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [audioRef]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef?.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="w-full flex flex-col gap-1 mb-6">
      <input
        type="range"
        min="0"
        max={duration || 30}
        step="0.1"
        value={currentTime}
        onChange={handleSeek}
        className="w-full accent-[#FA2D48] h-1.5 rounded-lg cursor-pointer opacity-90 hover:opacity-100"
        style={{ backgroundColor: 'var(--hint-color, rgba(150,150,150,0.3))' }}
      />
      <div className="flex justify-between text-[11px] font-semibold opacity-70" style={{ color: 'var(--text-color)' }}>
        <span>{formatTime(currentTime)}</span>
        <span>-{formatTime(Math.max(0, (duration || 30) - currentTime))}</span>
      </div>
    </div>
  );
});

export function GlobalAudioPlayer() {
  const { t } = useLanguage();
  const { currentTrack, isPlaying, isBuffering, togglePlayPause, nextTrack, prevTrack, stop, audioRef, isShuffle, toggleShuffle } = useAudioPlayer();
  const [isFav, setIsFav] = useState(false);
  const [isEqOpen, setIsEqOpen] = useState(false);
  const [isCardOpen, setIsCardOpen] = useState(false);

  const isMusic = currentTrack?.type === 'music';
  const favType = isMusic ? 'music' : 'radio';

  useEffect(() => {
    if (currentTrack?.id) {
      setIsFav(favoritesManager.isFavorite(favType, currentTrack.id));
    }
  }, [currentTrack?.id, favType]);

  if (!currentTrack) return null;

  const toggleFavorite = () => {
    if (!currentTrack) return;
    if (isFav) {
      favoritesManager.remove(favType, currentTrack.id);
      if (isMusic) {
        audioOfflineManager.removeTrackAudio(currentTrack.url, currentTrack.id);
      }
      setIsFav(false);
    } else {
      if (isMusic) {
        favoritesManager.add('music', {
          id: currentTrack.id,
          title: currentTrack.title,
          artist: currentTrack.artist,
          audioUrl: currentTrack.url,
          artworkUrl: currentTrack.coverUrl,
          type: 'music'
        });
        // Фоново кэшируем трек при добавлении в Избранное из глобального плеера
        if (currentTrack.url && !currentTrack.url.includes('preview')) {
          audioOfflineManager.saveTrackAudio(currentTrack.id, currentTrack.url, 'high').catch(() => {});
        }
      } else {
        favoritesManager.add('radio', {
          id: currentTrack.id,
          name: currentTrack.title,
          url: currentTrack.url,
          logo: currentTrack.coverUrl,
          group: currentTrack.artist,
          type: 'radio'
        });
      }
      setIsFav(true);
    }
    try {
      WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (_) {}
  };

  return (
    <>
      {/* Floating Bottom Mini-Player Bar */}
      <div
        className="fixed left-4 right-4 z-50 p-2.5 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-2xl transition-all"
        style={{
          bottom: '80px',
          backgroundColor: 'var(--bg-color)',
          borderColor: 'var(--hint-color)'
        }}
      >
        {/* Cover Art - Click to Open Now Playing Card Sheet */}
        <div 
          onClick={() => {
            try { WebApp?.HapticFeedback?.selectionChanged(); } catch (_) {}
            setIsCardOpen(true);
          }}
          className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-md relative cursor-pointer active:scale-95 transition-transform"
          style={{ backgroundColor: 'var(--hint-color)' }}
          title={t('player')}
        >
          {currentTrack.coverUrl ? (
            <img src={currentTrack.coverUrl} alt={currentTrack.title} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
          ) : (
            <span className="text-2xl">📻</span>
          )}
        </div>

        {/* Info - Click to Open Now Playing Card Sheet */}
        <div 
          onClick={() => {
            try { WebApp?.HapticFeedback?.selectionChanged(); } catch (_) {}
            setIsCardOpen(true);
          }}
          className="flex-1 min-w-0 cursor-pointer"
        >
          <div className="font-bold text-sm truncate" style={{ color: 'var(--text-color)' }}>
            {currentTrack.title}
          </div>
          <div className="text-xs opacity-70 truncate flex items-center gap-2" style={{ color: 'var(--text-color)' }}>
            {isBuffering && (
              <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block"></div>
            )}
            <span>{currentTrack.artist}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Favorite */}
          <button
            onClick={toggleFavorite}
            className="w-8 h-8 flex items-center justify-center rounded-full text-base transition-transform active:scale-125 cursor-pointer"
            style={{
              backgroundColor: isFav ? 'rgba(234, 179, 8, 0.2)' : 'transparent',
              color: isFav ? '#eab308' : 'var(--text-color)',
            }}
            title={isFav ? (t('removeFromFavorites') || 'Удалить из избранного') : (t('addToFavorites') || 'В избранное')}
            aria-label={isFav ? (t('removeFromFavorites') || 'Удалить из избранного') : (t('addToFavorites') || 'В избранное')}
          >
            {isFav ? '★' : '☆'}
          </button>

          {/* Previous Track */}
          <button
            onClick={prevTrack}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-transform cursor-pointer"
            style={{ color: 'var(--text-color)' }}
            title={t('prev') || 'Назад'}
            aria-label={t('prev') || 'Назад'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90 cursor-pointer"
            style={{ backgroundColor: 'var(--button-color, #3b82f6)', color: 'var(--button-text-color, #fff)' }}
            title={isPlaying ? (t('pause') || 'Пауза') : (t('play') || 'Воспроизвести')}
            aria-label={isPlaying ? (t('pause') || 'Пауза') : (t('play') || 'Воспроизвести')}
          >
            {isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
            )}
          </button>

          {/* Next Track */}
          <button
            onClick={nextTrack}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-transform cursor-pointer"
            style={{ color: 'var(--text-color)' }}
            title={t('next') || 'Вперед'}
            aria-label={t('next') || 'Вперед'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" />
            </svg>
          </button>

          {/* Close */}
          <button
            onClick={stop}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-500/30 transition-all active:scale-90 text-lg cursor-pointer"
            style={{ color: 'var(--text-color)' }}
            title={t('close') || 'Закрыть'}
            aria-label={t('close') || 'Закрыть'}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Full-Screen Now Playing Card Sheet */}
      {isCardOpen && currentTrack && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col justify-between p-6 animate-in slide-in-from-bottom duration-300 backdrop-blur-3xl overflow-y-auto"
          style={{
            backgroundColor: 'var(--bg-color)',
            color: 'var(--text-color)',
            paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 1.5rem))',
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 1.5rem))'
          }}
        >
          {/* Top Bar: Dismiss Chevron, Title */}
          <div className="flex items-center justify-between w-full">
            <button
              onClick={() => setIsCardOpen(false)}
              className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer active:scale-95 border"
              style={{
                backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.15))',
                borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.2))',
                color: 'var(--text-color)'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <span className="text-xs font-black tracking-widest uppercase opacity-60" style={{ color: 'var(--text-color)' }}>
              {currentTrack.type === 'radio' ? (t('tab_radio') || 'MediaBox Radio') : 'MediaBox Music'}
            </span>
            <div className="w-10 h-10" />
          </div>

          {/* Big Squircle Artwork with ambient shadow */}
          <div className="flex flex-col items-center justify-center my-auto py-4">
            <div 
              className={`w-64 h-64 sm:w-80 sm:h-80 rounded-3xl overflow-hidden shadow-2xl border transition-transform duration-500 ${
                isPlaying ? 'scale-100 shadow-[0_20px_50px_rgba(250,45,72,0.35)]' : 'scale-90 opacity-80'
              }`}
              style={{
                borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.2))',
                backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.1))'
              }}
            >
              {currentTrack.coverUrl ? (
                <img 
                  src={currentTrack.coverUrl} 
                  alt={currentTrack.title} 
                  className="w-full h-full object-cover" 
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-7xl" style={{ backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.1))' }}>
                  {currentTrack.type === 'radio' ? '📻' : '🎵'}
                </div>
              )}
            </div>

            {/* Quality pill & Equalizer shortcut */}
            <button
              onClick={() => setIsEqOpen(true)}
              className="mt-4 px-3.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors active:scale-95 cursor-pointer"
              style={{
                backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.15))',
                borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.25))',
                color: 'var(--text-color)'
              }}
            >
              <span>{currentTrack.type === 'radio' ? 'LIVE 320k' : 'Lossless'}</span>
              <span className="text-[#FA2D48] font-bold">🎚️ {t('equalizer')}</span>
            </button>
          </div>

          {/* Track Details & Actions */}
          <div className="w-full max-w-md mx-auto mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1 min-w-0 pr-4">
                <h1 className="text-2xl font-black truncate" style={{ color: 'var(--text-color)' }}>{currentTrack.title}</h1>
                <p className="text-base font-semibold truncate opacity-70" style={{ color: 'var(--text-color)' }}>{currentTrack.artist}</p>
              </div>
              <div className="flex items-center gap-3">
                {currentTrack.type === 'music' && (
                  <button
                    onClick={() => {
                      audioOfflineManager.exportTrack({
                        id: currentTrack.id,
                        title: currentTrack.title,
                        artist: currentTrack.artist,
                        audioUrl: currentTrack.url
                      });
                    }}
                    className="p-1.5 opacity-70 hover:opacity-100 transition-transform active:scale-90 cursor-pointer"
                    style={{ color: 'var(--text-color)' }}
                    title={t('music_to_files') || 'В Файлы / Скачать'}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={toggleFavorite}
                  className="text-2xl transition-transform active:scale-125 cursor-pointer"
                >
                  {isFav ? '❤️' : '🤍'}
                </button>
              </div>
            </div>

            {/* Scrubber slider (for music) */}
            {currentTrack.type === 'music' && (
              <AudioProgressBar audioRef={audioRef} />
            )}

            {/* Media Controls */}
            <div className="flex items-center justify-between w-full max-w-xs sm:max-w-sm mx-auto mb-6 px-1">
              {/* Left: Shuffle */}
              <div className="w-10 flex justify-start">
                {currentTrack.type === 'music' ? (
                  <button 
                    onClick={toggleShuffle}
                    className={`p-2.5 rounded-full transition-all active:scale-90 cursor-pointer ${
                      isShuffle ? 'text-[#FA2D48] bg-[#FA2D48]/15' : 'opacity-40 hover:opacity-70'
                    }`}
                    style={{ color: isShuffle ? '#FA2D48' : 'var(--text-color)' }}
                    title={t('music_shuffle')}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 3 21 3 21 8" />
                      <line x1="4" y1="20" x2="21" y2="3" />
                      <polyline points="21 16 21 21 16 21" />
                      <line x1="15" y1="15" x2="21" y2="21" />
                      <line x1="4" y1="4" x2="9" y2="9" />
                    </svg>
                  </button>
                ) : <div className="w-10" />}
              </div>

              {/* Center: Prev - Play/Pause - Next (strictly centered) */}
              <div className="flex items-center justify-center gap-4 sm:gap-6">
                <button 
                  onClick={prevTrack}
                  className="p-3 opacity-80 hover:opacity-100 active:scale-90 transition-transform cursor-pointer"
                  style={{ color: 'var(--text-color)' }}
                  title={t('prev') || 'Назад'}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5"/></svg>
                </button>

                <button 
                  onClick={togglePlayPause}
                  className="w-16 h-16 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-transform cursor-pointer"
                  style={{
                    backgroundColor: 'var(--button-color, #FA2D48)',
                    color: 'var(--button-text-color, #fff)'
                  }}
                  title={isPlaying ? (t('pause') || 'Пауза') : (t('play') || 'Воспроизвести')}
                >
                  {isPlaying ? (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  ) : (
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><polygon points="5 3 19 12 5 21" /></svg>
                  )}
                </button>

                <button 
                  onClick={nextTrack}
                  className="p-3 opacity-80 hover:opacity-100 active:scale-90 transition-transform cursor-pointer"
                  style={{ color: 'var(--text-color)' }}
                  title={t('next') || 'Вперед'}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5"/></svg>
                </button>
              </div>

              {/* Right: Return to playlist / favorites */}
              <div className="w-10 flex justify-end">
                <button
                  onClick={() => setIsCardOpen(false)}
                  className="p-2.5 rounded-full opacity-60 hover:opacity-100 active:scale-90 transition-all cursor-pointer"
                  style={{ color: 'var(--text-color)' }}
                  title={t('returnToList') || 'К плейлисту'}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Studio Equalizer Sheet */}
      <EqualizerModal isOpen={isEqOpen} onClose={() => setIsEqOpen(false)} />
    </>
  );
}
