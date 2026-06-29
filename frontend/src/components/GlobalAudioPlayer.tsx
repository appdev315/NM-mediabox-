import { useState, useEffect } from 'react';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLocation } from 'react-router-dom';

export function GlobalAudioPlayer() {
  const { currentTrack, isPlaying, isBuffering, togglePlayPause, stop } = useAudioPlayer();
  const location = useLocation();
  const [isFav, setIsFav] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    try {
      const favs = JSON.parse(localStorage.getItem('radio_tv_favs') || '[]');
      setIsFav(favs.some((f: any) => f.id === currentTrack.id));
    } catch(e){}
  }, [currentTrack]);

  const toggleFavorite = () => {
    if (!currentTrack) return;
    try {
      const favs = JSON.parse(localStorage.getItem('radio_tv_favs') || '[]');
      let newFavs;
      if (isFav) {
        newFavs = favs.filter((f: any) => f.id !== currentTrack.id);
        setIsFav(false);
      } else {
        const item = {
          id: currentTrack.id,
          name: currentTrack.title,
          url: currentTrack.url,
          logo: currentTrack.coverUrl || '',
          type: currentTrack.type || 'radio'
        };
        newFavs = [...favs, item];
        setIsFav(true);
      }
      localStorage.setItem('radio_tv_favs', JSON.stringify(newFavs));
      // Dispatch custom event to notify RadioTV page if it's open
      window.dispatchEvent(new Event('radio_favs_updated'));
    } catch(e){}
  };

  if (!currentTrack) return null;

  // Hide on movie/video player pages
  if (location.pathname.includes('/movie/') || location.pathname.includes('/adult/')) return null;

  return (
    <div
      className="fixed left-4 right-4 z-50 p-3 rounded-2xl shadow-2xl backdrop-blur-2xl flex items-center gap-3 border"
      style={{
        bottom: '80px',
        backgroundColor: 'var(--secondary-bg-color, rgba(30, 30, 30, 0.95))',
        borderColor: 'var(--hint-color, rgba(255, 255, 255, 0.1))'
      }}
    >
      {/* Cover Art */}
      <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-md relative"
        style={{ backgroundColor: 'var(--hint-color, rgba(100, 100, 100, 0.2))' }}
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
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Favorite */}
        <button
          onClick={toggleFavorite}
          className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 text-lg"
          style={{ color: isFav ? 'var(--button-color, #3b82f6)' : 'var(--text-color)' }}
        >
          {isFav ? '★' : '☆'}
        </button>

        {/* Prev (Play/Pause) */}
        <button
          onClick={togglePlayPause}
          className="w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90"
          style={{ backgroundColor: 'var(--button-color, #3b82f6)', color: 'var(--button-text-color, #fff)' }}
        >
          <span className="text-lg">{isPlaying ? '⏸' : '▶️'}</span>
        </button>

        {/* Next (Stop) */}
        <button
          onClick={stop}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-500/30 transition-all active:scale-90 text-lg"
          style={{ color: 'var(--text-color)' }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
