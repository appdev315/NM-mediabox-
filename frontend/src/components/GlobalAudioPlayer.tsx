import { useState, useEffect } from 'react';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLanguage } from '../context/LanguageContext';
import { favoritesManager } from '../utils/favoritesManager';
import { WebApp } from '../telegram';
import { EqualizerModal } from './EqualizerModal';

export function GlobalAudioPlayer() {
  const { t } = useLanguage();
  const { currentTrack, isPlaying, isBuffering, togglePlayPause, nextTrack, prevTrack, stop } = useAudioPlayer();
  const [isFav, setIsFav] = useState(false);
  const [isEqOpen, setIsEqOpen] = useState(false);

  useEffect(() => {
    if (currentTrack?.id) {
      setIsFav(favoritesManager.isFavorite('radio', currentTrack.id));
    }
  }, [currentTrack?.id]);

  if (!currentTrack) return null;

  const toggleFavorite = () => {
    if (!currentTrack) return;
    if (isFav) {
      favoritesManager.remove('radio', currentTrack.id);
      setIsFav(false);
    } else {
      favoritesManager.add('radio', {
        id: currentTrack.id,
        name: currentTrack.title,
        url: currentTrack.url,
        logo: currentTrack.coverUrl,
        group: currentTrack.artist,
        type: 'radio'
      });
      setIsFav(true);
    }
    try {
      WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (_) {}
  };

  return (
    <>
      <div
        className="fixed left-4 right-4 z-50 p-3 rounded-2xl shadow-2xl flex items-center gap-3 border"
        style={{
          bottom: '80px',
          backgroundColor: 'var(--bg-color)',
          borderColor: 'var(--hint-color)'
        }}
      >
        {/* Cover Art */}
        <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-md relative"
          style={{ backgroundColor: 'var(--hint-color)' }}
        >
          {currentTrack.coverUrl ? (
            <img src={currentTrack.coverUrl} alt={currentTrack.title} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
          ) : (
            <span className="text-2xl">📻</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
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
          {/* Equalizer */}
          <button
            onClick={() => setIsEqOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-transform text-sm"
            style={{ color: 'var(--text-color)' }}
            title={t('equalizer')}
            aria-label={t('equalizer')}
          >
            🎚️
          </button>

          {/* Favorite */}
          <button
            onClick={toggleFavorite}
            className="w-8 h-8 flex items-center justify-center rounded-full text-base transition-transform active:scale-125"
            style={{
              backgroundColor: isFav ? 'rgba(234, 179, 8, 0.2)' : 'transparent',
              color: isFav ? '#eab308' : 'var(--text-color)',
            }}
            title={isFav ? (t('removeFromFavorites') || 'Удалить из избранного') : (t('addToFavorites') || 'В избранное')}
            aria-label="В избранное"
          >
            {isFav ? '★' : '☆'}
          </button>

          {/* Previous Track */}
          <button
            onClick={prevTrack}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-transform"
            style={{ color: 'var(--text-color)' }}
            title={t('prevTrailer') || 'Предыдущий трек'}
            aria-label="Предыдущий трек"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90"
            style={{ backgroundColor: 'var(--button-color, #3b82f6)', color: 'var(--button-text-color, #fff)' }}
            title={isPlaying ? 'Пауза' : 'Воспроизведение'}
            aria-label={isPlaying ? 'Пауза' : 'Воспроизведение'}
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
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-transform"
            style={{ color: 'var(--text-color)' }}
            title={t('nextTrailer') || 'Следующий трек'}
            aria-label="Следующий трек"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" />
            </svg>
          </button>

          {/* Close */}
          <button
            onClick={stop}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-500/30 transition-all active:scale-90 text-lg"
            style={{ color: 'var(--text-color)' }}
            title={t('close') || 'Закрыть'}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Studio Equalizer Sheet */}
      <EqualizerModal isOpen={isEqOpen} onClose={() => setIsEqOpen(false)} />
    </>
  );
}
