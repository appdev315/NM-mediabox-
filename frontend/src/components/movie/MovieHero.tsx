import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebApp } from '../../telegram';
import { useLanguage } from '../../context/LanguageContext';

export interface MovieHeroProps {
  movie: any;
  mediaType: 'movie' | 'tv';
  isFavorite: boolean;
  onToggleFavorite: () => void;
  ratingPct: number;
  trailerVideo: any | null;
  onOpenTrailer: () => void;
  contentUnavailable: boolean;
  isUnreleased: boolean;
  isExtracting: boolean;
  iframeUrl: string | null;
  onWatch: () => void;
  formatRuntime: (minutes: number) => string;
}

export const MovieHero: React.FC<MovieHeroProps> = ({
  movie,
  mediaType,
  isFavorite,
  onToggleFavorite,
  ratingPct,
  trailerVideo,
  onOpenTrailer,
  contentUnavailable,
  isUnreleased,
  isExtracting,
  iframeUrl,
  onWatch,
  formatRuntime,
}) => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [showShareMenu, setShowShareMenu] = useState(false);

  return (
    <>
      {/* Backdrop Image with gradient overlay */}
      <div className="relative">
        <img 
          key={movie.backdrop || movie.poster || movie.id}
          src={movie.backdrop || movie.poster || 'https://placehold.co/800x450/1c2431/ffffff?text=No+Backdrop'} 
          alt={movie.title || movie.name || 'Постер фильма'} 
          loading="lazy"
          className="w-full aspect-[16/9] max-h-[50vh] object-cover"
          onError={(e) => {
            const el = e.currentTarget as HTMLImageElement & { dataset: DOMStringMap };
            if (!el.dataset.fbk) {
              el.dataset.fbk = '1';
              const alt = el.src === movie.poster ? movie.backdrop : movie.poster;
              if (alt && alt !== el.src) {
                el.src = alt;
                return;
              }
            }
            el.src = 'https://placehold.co/800x450/1c2431/ffffff?text=No+Backdrop';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-color)] via-[var(--bg-color)]/40 to-transparent"></div>
      </div>

      <div className="-mt-20 relative z-10 p-4">
        {/* Title and Action Buttons (Favorite + Share) */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <h1 className="text-3xl font-black leading-tight drop-shadow-md">{movie.title || movie.name}</h1>
            <p className="text-sm opacity-70 font-semibold">{movie.year}</p>
          </div>
          <div className="flex gap-2 relative z-50">
            <button 
              onClick={onToggleFavorite}
              title={isFavorite ? (t('removeFromFavorites') || 'Удалить из избранного') : (t('addToFavorites') || 'В избранное')}
              style={{ 
                backgroundColor: isFavorite ? 'rgba(245, 158, 11, 0.2)' : 'var(--hint-color)', 
                color: isFavorite ? '#f59e0b' : 'var(--text-color)',
                border: isFavorite ? '1px solid rgba(245, 158, 11, 0.4)' : 'none'
              }}
              className="p-3 rounded-full shadow-lg active:scale-95 transition-all flex-shrink-0 flex items-center justify-center"
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill={isFavorite ? "#f59e0b" : "none"} 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>

            <button 
              onClick={() => setShowShareMenu(!showShareMenu)}
              style={{ backgroundColor: 'var(--hint-color)', color: 'var(--button-color)' }}
              className="p-3 rounded-full shadow-lg active:scale-95 transition-transform flex-shrink-0"
              aria-label="Share"
            >
              ➦
            </button>

            {showShareMenu && (
              <div 
                className="absolute top-14 right-0 shadow-2xl rounded-xl p-3 w-52 flex flex-col gap-2 border"
                style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--hint-color)' }}
              >
                <button
                  onClick={() => {
                    setShowShareMenu(false);
                    const tgLink = `https://t.me/moviemaniakbot/app?startapp=${mediaType}_${movie?.id}`;
                    const text = `Watch "${movie?.title}" for free on MediaBox!`;
                    WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(tgLink)}&text=${encodeURIComponent(text)}`);
                  }}
                  className="flex items-center gap-3 p-2 text-sm font-semibold rounded-lg hover:opacity-80 active:opacity-60 transition-all text-left"
                  style={{ color: '#0088cc' }}
                >
                  <span className="text-lg">🚀</span> {t('shareTelegram') || 'Share to Telegram'}
                </button>
                
                <div className="h-px w-full" style={{ backgroundColor: 'var(--hint-color)' }}></div>
                
                <button
                  onClick={() => {
                    setShowShareMenu(false);
                    const webLink = `https://media-box.xyz/movie/${movie?.id}?type=${mediaType}`;
                    navigator.clipboard.writeText(webLink).then(() => {
                      WebApp.HapticFeedback.notificationOccurred('success');
                      if (WebApp.showAlert) WebApp.showAlert(t('addressCopied') || 'Ссылка скопирована!');
                      else alert(t('addressCopied') || 'Ссылка скопирована!');
                    });
                  }}
                  className="flex items-center gap-3 p-2 text-sm font-semibold rounded-lg hover:opacity-80 active:opacity-60 transition-all text-left"
                  style={{ color: 'var(--text-color)' }}
                >
                  <span className="text-lg">🔗</span> {t('copyLink') || 'Copy Link'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sub-header info (Age certification, Genres, Runtime) */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold opacity-90 mb-4">
          {movie.certification && (
            <span className="border border-white/30 bg-white/10 px-1.5 py-0.5 rounded text-[11px] font-bold">
              {movie.certification}
            </span>
          )}
          {movie.release_date && <span>{movie.release_date}</span>}
          {movie.genre && <span>• {movie.genre}</span>}
          {movie.runtime > 0 && <span>• {formatRuntime(movie.runtime)}</span>}
        </div>

        {/* Rating & Trailer Action Bar */}
        <div className="flex items-center gap-4 mb-6">
          {ratingPct > 0 && (
            <div className="flex items-center gap-2 bg-black/40 border border-white/10 px-3 py-1.5 rounded-full shadow-inner">
              <div className="w-8 h-8 rounded-full border-2 border-green-400 flex items-center justify-center font-extrabold text-xs text-green-400">
                {ratingPct}%
              </div>
              <span className="text-xs font-bold opacity-80">{t('tmdbRating')}</span>
            </div>
          )}

          {trailerVideo && (
            <button
              onClick={onOpenTrailer}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 px-3.5 py-2 rounded-full text-xs font-bold transition-all active:scale-95 shadow"
            >
              ▶ {t('playTrailer')}
            </button>
          )}
        </div>

        {/* Tagline / Слоган */}
        {movie.tagline && (
          <p className="italic text-2xl sm:text-3xl font-black opacity-95 mb-6 font-serif leading-snug drop-shadow-md text-amber-200/90">
            «{movie.tagline}»
          </p>
        )}

        {/* Content unavailable fallback banner */}
        {contentUnavailable && !isExtracting && !iframeUrl && (
          <div className="mb-6 p-6 rounded-2xl text-center space-y-4" style={{ backgroundColor: 'var(--hint-color)' }}>
            <div className="text-4xl">🎬</div>
            <div className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 font-bold text-base select-none">
              ✨ {t('comingSoonMediaBox') || 'Скоро на MediaBox'}
            </div>
            <div className="flex flex-col items-center gap-3 pt-2">
              {trailerVideo && (
                <button
                  onClick={onOpenTrailer}
                  className="w-full sm:w-auto px-6 py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95 shadow flex items-center justify-center gap-2 cursor-pointer"
                  style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
                >
                  ▶ {t('watchTrailerOfficial') || t('playTrailer') || 'Смотреть трейлер'}
                </button>
              )}

              <button
                onClick={() => navigate('/')}
                className="text-xs font-semibold opacity-70 hover:opacity-100 transition-opacity mt-1 cursor-pointer"
                style={{ color: 'var(--text-color)' }}
              >
                ← {t('chooseAnother') || 'Выбрать другой фильм'}
              </button>
            </div>
          </div>
        )}

        {/* Watch Action Button / Unreleased Movie Notice */}
        {!isExtracting && !iframeUrl && !contentUnavailable && (
          <div className="flex flex-col gap-3 mb-6">
            {isUnreleased ? (
              <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-col gap-3">
                <div className="flex items-center gap-2.5 text-amber-400 font-bold text-sm">
                  <span className="text-xl">🗓️</span>
                  <div>
                    <p>{t('unreleasedMovie') || 'Фильм ещё не вышел в кинотеатрах'}</p>
                    {movie.release_date && (
                      <p className="text-xs font-medium opacity-80 mt-0.5">
                        {t('premiereDate') || 'Премьера'}: {movie.release_date}
                      </p>
                    )}
                  </div>
                </div>
                
                {trailerVideo ? (
                  <button
                    onClick={onOpenTrailer}
                    className="w-full py-3.5 rounded-xl font-bold text-base transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg bg-amber-500 text-black hover:bg-amber-400"
                  >
                    ▶ {t('watchTrailerOfficial') || 'Смотреть трейлер'}
                  </button>
                ) : (
                  <p className="text-xs opacity-70 italic text-center py-1">
                    {t('inProductionDesc') || 'Фильм находится на стадии производства. Официальный трейлер появится позже.'}
                  </p>
                )}
              </div>
            ) : (
              <button
                onClick={onWatch}
                className="w-full py-4 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
              >
                ▶ {t('watch')}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
};
