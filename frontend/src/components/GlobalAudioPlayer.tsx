import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLocation } from 'react-router-dom';

export function GlobalAudioPlayer() {
  const { currentTrack, isPlaying, isBuffering, togglePlayPause, stop } = useAudioPlayer();
  const location = useLocation();


  if (!currentTrack) return null;

  // Hide on movie/video player pages
  if (location.pathname.includes('/movie/') || location.pathname.includes('/adult/')) return null;

  return (
    <div
      className="fixed left-4 right-4 z-50 p-3 rounded-2xl shadow-2xl backdrop-blur-2xl flex items-center gap-3 border"
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
      <div className="flex items-center gap-2 flex-shrink-0">

        {/* Prev (Play/Pause) */}
        <button
          onClick={togglePlayPause}
          className="w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90"
          style={{ backgroundColor: 'var(--button-color, #3b82f6)', color: 'var(--button-text-color, #fff)' }}
        >
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
          )}
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
