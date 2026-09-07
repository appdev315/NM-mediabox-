import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useApi, type TrailerFeedItem } from '../hooks/useApi';
import { favoritesManager } from '../utils/favoritesManager';
import { WebApp } from '../telegram';

const STORAGE_KEY = 'mb_viewed_trailers_v1';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (1 day)

const getViewedTrailerIds = (): Set<number> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: Record<string, number> = JSON.parse(raw);
    const now = Date.now();
    const valid = new Set<number>();
    let hasExpired = false;
    const cleanRecord: Record<string, number> = {};

    for (const [key, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && now - ts < TTL_MS) {
        valid.add(Number(key));
        cleanRecord[key] = ts;
      } else {
        hasExpired = true;
      }
    }

    if (hasExpired) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanRecord));
    }
    return valid;
  } catch {
    return new Set();
  }
};

const markTrailerAsViewed = (id: number): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
    parsed[String(id)] = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    window.dispatchEvent(new CustomEvent('mb_trailer_viewed', { detail: { id } }));
  } catch {
    // Ignore storage write issues
  }
};

const shuffleArray = <T,>(array: T[]): T[] => {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const prioritizeUnviewedTrailers = (items: TrailerFeedItem[], shuffleIfAllViewed: boolean = false): TrailerFeedItem[] => {
  const viewedIds = getViewedTrailerIds();
  const unviewed: TrailerFeedItem[] = [];
  const viewed: TrailerFeedItem[] = [];

  items.forEach(item => {
    if (viewedIds.has(item.id)) {
      viewed.push(item);
    } else {
      unviewed.push(item);
    }
  });

  if (unviewed.length === 0 && shuffleIfAllViewed) {
    return shuffleArray(items);
  }

  return [...unviewed, ...viewed];
};

export { getViewedTrailerIds, markTrailerAsViewed, prioritizeUnviewedTrailers };

export interface TrailerFeedProps {
  initialTrailerId?: number;
  initialIndex?: number;
  isModal?: boolean;
  onClose?: () => void;
}

export const TrailerFeed: React.FC<TrailerFeedProps> = ({ initialTrailerId, initialIndex = 0, isModal = false, onClose }) => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { fetchTrailerFeed } = useApi();

  const [trailers, setTrailers] = useState<TrailerFeedItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [favoriteMap, setFavoriteMap] = useState<Record<number, boolean>>({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Load initial trailer feed
  useEffect(() => {
    let isMounted = true;
    setInitialLoading(true);
    setTrailers([]);
    setPage(1);
    setActiveIndex(0);

    fetchTrailerFeed(1)
      .then(items => {
        if (!isMounted) return;
        const isFromWatchAll = initialTrailerId === undefined;
        const prioritized = prioritizeUnviewedTrailers(items, isFromWatchAll);
        setTrailers(prioritized);
        setHasMore(items.length > 0);
        // Hydrate favorites
        const favs: Record<number, boolean> = {};
        prioritized.forEach(it => {
          favs[it.id] = favoritesManager.isFavorite(it.mediaType === 'tv' ? 'series' : 'movie', it.id);
        });
        setFavoriteMap(favs);

        let targetIndex = 0;
        if (initialTrailerId !== undefined) {
          const foundIdx = prioritized.findIndex(it => it.id === initialTrailerId);
          if (foundIdx !== -1) {
            targetIndex = foundIdx;
          }
          markTrailerAsViewed(initialTrailerId);
        } else if (initialIndex > 0 && initialIndex < prioritized.length) {
          targetIndex = initialIndex;
        }

        if (targetIndex > 0) {
          setActiveIndex(targetIndex);
          setTimeout(() => {
            cardRefs.current[targetIndex]?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
          }, 80);
        }
      })
      .catch(err => {
        console.error('Failed to load initial trailer feed:', err);
      })
      .finally(() => {
        if (isMounted) setInitialLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [fetchTrailerFeed, language]);

  // Load next page
  const loadMoreTrailers = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const nextPage = page + 1;
    try {
      const nextItems = await fetchTrailerFeed(nextPage);
      if (!nextItems || nextItems.length === 0) {
        setHasMore(false);
      } else {
        setTrailers(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const unique = nextItems.filter(p => !existingIds.has(p.id));
          const prioritized = prioritizeUnviewedTrailers(unique, initialTrailerId === undefined);
          return [...prev, ...prioritized];
        });
        setPage(nextPage);

        // Update favs
        setFavoriteMap(prev => {
          const updated = { ...prev };
          nextItems.forEach(it => {
            if (updated[it.id] === undefined) {
              updated[it.id] = favoritesManager.isFavorite(it.mediaType === 'tv' ? 'series' : 'movie', it.id);
            }
          });
          return updated;
        });
      }
    } catch (e) {
      console.error('Failed to load more trailers:', e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchTrailerFeed, hasMore, isLoadingMore, page]);

  // IntersectionObserver to detect currently centered trailer card
  useEffect(() => {
    if (!containerRef.current || trailers.length === 0) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-index'));
            if (!isNaN(index) && index !== activeIndexRef.current) {
              setActiveIndex(index);
              if (WebApp.HapticFeedback) {
                WebApp.HapticFeedback.selectionChanged();
              }
            }
          }
        });
      },
      {
        root: containerRef.current,
        threshold: 0.6,
      }
    );

    cardRefs.current.forEach(ref => {
      if (ref) observer.observe(ref);
    });

    return () => {
      observer.disconnect();
    };
  }, [trailers]);

  // Infinite scroll trigger when reaching bottom 3 items
  useEffect(() => {
    if (activeIndex >= trailers.length - 3 && hasMore && !isLoadingMore) {
      loadMoreTrailers();
    }
  }, [activeIndex, trailers.length, hasMore, isLoadingMore, loadMoreTrailers]);

  // Scroll to index helper
  const scrollToIndex = useCallback((idx: number) => {
    if (idx < 0 || idx >= trailers.length) return;
    cardRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setActiveIndex(idx);
  }, [trailers.length]);

  // Desktop mouse wheel navigation (TikTok/Shorts style)
  const isWheelingRef = useRef(false);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isWheelingRef.current) return;
    if (Math.abs(e.deltaY) > 25) {
      isWheelingRef.current = true;
      if (e.deltaY > 0) {
        scrollToIndex(activeIndex + 1);
      } else {
        scrollToIndex(activeIndex - 1);
      }
      setTimeout(() => {
        isWheelingRef.current = false;
      }, 400);
    }
  }, [activeIndex, scrollToIndex]);

  // Desktop keyboard navigation (ArrowUp/ArrowDown) & Escape for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModal && onClose && e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        scrollToIndex(activeIndex + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        scrollToIndex(activeIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, scrollToIndex, isModal, onClose]);

  // Toggle favorite
  const handleToggleFavorite = (item: TrailerFeedItem) => {
    const favType = item.mediaType === 'tv' ? 'series' : 'movie';
    const isFav = !!favoriteMap[item.id];
    if (isFav) {
      favoritesManager.remove(favType, item.id);
      setFavoriteMap(prev => ({ ...prev, [item.id]: false }));
      if (WebApp.HapticFeedback) WebApp.HapticFeedback.impactOccurred('light');
    } else {
      favoritesManager.add(favType, {
        id: item.id,
        title: item.title,
        poster: item.poster,
        rating: item.rating,
        year: item.year,
        type: favType,
      });
      setFavoriteMap(prev => ({ ...prev, [item.id]: true }));
      if (WebApp.HapticFeedback) WebApp.HapticFeedback.impactOccurred('medium');
    }
  };


  // Mark active trailer as viewed in device cache after 1.0 second
  useEffect(() => {
    const currentItem = trailers[activeIndex];
    if (!currentItem) return;

    const timer = window.setTimeout(() => {
      markTrailerAsViewed(currentItem.id);
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeIndex, trailers]);

  // Navigate to player
  const handleWatchMovie = (item: TrailerFeedItem) => {
    markTrailerAsViewed(item.id);
    if (WebApp.HapticFeedback) WebApp.HapticFeedback.impactOccurred('heavy');
    navigate(`/movie/${item.id}?type=${item.mediaType === 'tv' ? 'series' : 'movie'}`);
  };

  if (initialLoading) {
    const loadingView = (
      <div className="w-full h-[70vh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="w-12 h-12 rounded-full border-3 border-blue-500 border-t-transparent animate-spin" />
        <p className="text-gray-400 font-medium text-sm animate-pulse">
          🎬 {t('loading') || 'Загрузка лучших трейлеров...'}
        </p>
      </div>
    );

    if (isModal) {
      return (
        <div className="fixed inset-0 z-50 bg-black/98 flex flex-col items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
          <button
            onClick={onClose}
            className="fixed top-4 right-4 z-50 w-11 h-11 rounded-full bg-black/80 hover:bg-gray-800 text-white flex items-center justify-center text-xl font-bold border border-white/20 shadow-2xl transition-transform active:scale-90 backdrop-blur-md cursor-pointer"
            title="Закрыть"
            aria-label="Закрыть"
          >
            ✕
          </button>
          {loadingView}
        </div>
      );
    }

    return loadingView;
  }

  if (trailers.length === 0) {
    const emptyView = (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center gap-3 text-center px-4">
        <span className="text-4xl">🎬</span>
        <p className="text-white font-bold text-base">{t('notFound') || 'Трейлеры не найдены'}</p>
        <button
          onClick={() => {
            setInitialLoading(true);
            fetchTrailerFeed(1).then(setTrailers).finally(() => setInitialLoading(false));
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold cursor-pointer"
        >
          {t('retry') || 'Повторить'}
        </button>
      </div>
    );

    if (isModal) {
      return (
        <div className="fixed inset-0 z-50 bg-black/98 flex flex-col items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
          <button
            onClick={onClose}
            className="fixed top-4 right-4 z-50 w-11 h-11 rounded-full bg-black/80 hover:bg-gray-800 text-white flex items-center justify-center text-xl font-bold border border-white/20 shadow-2xl transition-transform active:scale-90 backdrop-blur-md cursor-pointer"
            title="Закрыть"
            aria-label="Закрыть"
          >
            ✕
          </button>
          {emptyView}
        </div>
      );
    }

    return emptyView;
  }

  const content = (
    <div className={`relative w-full ${isModal ? 'max-w-md sm:max-w-lg h-full flex flex-col justify-center' : 'max-w-2xl'} mx-auto`}>
      {/* Desktop/Tablet Quick Nav Arrows */}
      <div className="hidden sm:flex fixed right-8 bottom-24 z-40 flex-col gap-2">
        <button
          onClick={() => scrollToIndex(activeIndex - 1)}
          disabled={activeIndex === 0}
          className="p-3 bg-gray-900/80 hover:bg-gray-800 disabled:opacity-30 text-white rounded-full backdrop-blur-md border border-white/10 shadow-xl transition-transform active:scale-95"
          title={t('prevTrailer') || 'Предыдущий'}
        >
          ▲
        </button>
        <button
          onClick={() => scrollToIndex(activeIndex + 1)}
          disabled={activeIndex === trailers.length - 1}
          className="p-3 bg-gray-900/80 hover:bg-gray-800 disabled:opacity-30 text-white rounded-full backdrop-blur-md border border-white/10 shadow-xl transition-transform active:scale-95"
          title={t('nextTrailer') || 'Следующий'}
        >
          ▼
        </button>
      </div>

      {/* Snap Scroll Vertical Feed */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="w-full h-[calc(100vh-145px)] overflow-y-auto snap-y snap-mandatory hide-scrollbar rounded-2xl flex flex-col gap-6"
        style={{ scrollBehavior: 'smooth' }}
      >
        {trailers.map((item, index) => {
          const isActive = index === activeIndex;
          const isFav = !!favoriteMap[item.id];
          const isNear = Math.abs(index - activeIndex) <= 1;

          return (
            <div
              key={`${item.id}-${index}`}
              ref={el => { cardRefs.current[index] = el; }}
              data-index={index}
              className="snap-start snap-always relative w-full h-[calc(100vh-145px)] max-h-[720px] rounded-2xl overflow-hidden bg-black flex flex-col justify-between border border-white/10 shadow-2xl shrink-0"
            >
              {!isNear ? (
                /* Virtualized offscreen card placeholder - saves GPU memory on mobile Safari */
                <div
                  onClick={() => {
                    setActiveIndex(index);
                    scrollToIndex(index);
                  }}
                  className="w-full h-full flex flex-col items-center justify-between p-6 bg-gray-950 cursor-pointer"
                >
                  <div />
                  <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl text-gray-400">
                    🎬
                  </div>
                  <div className="w-full text-left">
                    <p className="text-sm font-bold text-gray-400 truncate">{item.title}</p>
                    {item.originalTitle && item.originalTitle !== item.title && (
                      <p className="text-xs text-gray-500 italic truncate -mt-0.5">{item.originalTitle}</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Media Video or Thumbnail */}
                  <div className="relative w-full flex-1 bg-black overflow-hidden">
                    {isActive ? (
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${item.trailerKey}?autoplay=1&mute=${isMuted ? 1 : 0}&playsinline=1&rel=0&controls=1`}
                        title={`Trailer for ${item.title}`}
                        className="w-full h-full border-0 absolute inset-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    ) : (
                      <div
                        onClick={() => {
                          setActiveIndex(index);
                          scrollToIndex(index);
                        }}
                        className="w-full h-full absolute inset-0 cursor-pointer bg-cover bg-center flex items-center justify-center transition-transform hover:scale-105 duration-300"
                        style={{
                          backgroundImage: `url(${item.backdrop || item.poster})`,
                        }}
                      >
                        <div className="absolute inset-0 bg-black/40" />
                        <div className="w-16 h-16 rounded-full bg-blue-600/90 text-white flex items-center justify-center text-2xl shadow-2xl pl-1 animate-pulse border border-white/20">
                          ▶
                        </div>
                      </div>
                    )}

                    {/* Floating Sound Toggle Pill */}
                    {isActive && (
                      <button
                        onClick={() => {
                          setIsMuted(prev => !prev);
                          if (WebApp.HapticFeedback) WebApp.HapticFeedback.impactOccurred('light');
                        }}
                        className="absolute top-4 left-4 z-30 px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-transform active:scale-95 shadow-lg"
                      >
                        <span>{isMuted ? '🔇' : '🔊'}</span>
                        <span>{isMuted ? (t('trailerSoundOff') || 'Без звука') : (t('trailerSoundOn') || 'Звук')}</span>
                      </button>
                    )}

                    {/* Right Side Action Bar (Reels Style) */}
                    <div className="absolute right-3 bottom-12 sm:bottom-16 z-30 flex flex-col items-center gap-3">
                      {/* Primary Watch Button (Direct navigation to movie/series) */}
                      <button
                        onClick={() => handleWatchMovie(item)}
                        className="w-12 h-12 rounded-full flex flex-col items-center justify-center bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-2xl shadow-blue-600/50 border border-white/30 transition-transform active:scale-90"
                        title={item.mediaType === 'tv' ? (t('watchSeries') || 'Смотреть сериал') : (t('watchMovie') || 'Смотреть фильм')}
                        aria-label="Смотреть фильм или сериал"
                      >
                        <span className="text-xl pl-0.5">▶️</span>
                      </button>
                      <span className="text-[10px] font-black text-white drop-shadow -mt-2">
                        {t('watch') || 'Смотреть'}
                      </span>

                      {/* Favorite button */}
                      <button
                        onClick={() => handleToggleFavorite(item)}
                        className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md border border-white/10 shadow-xl transition-transform active:scale-90 ${
                          isFav ? 'bg-red-500/90 text-white' : 'bg-black/60 text-white hover:bg-black/80'
                        }`}
                        aria-label={t('favorites') || 'Избранное'}
                      >
                        <span className="text-lg">{isFav ? '❤️' : '🤍'}</span>
                      </button>
                      <span className="text-[10px] font-black text-white drop-shadow -mt-2">
                        {t('favorites') || 'Избранное'}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Card Info Overlay */}
                  <div className="relative z-20 w-full bg-gradient-to-t from-gray-950 via-gray-950/90 to-transparent pt-6 pb-4 px-3.5 sm:px-4 flex flex-col gap-2">
                    {/* Meta header: media type, rating, year, genres */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="px-1.5 py-0.5 rounded-md bg-blue-500/20 border border-blue-500/30 text-blue-300 font-extrabold text-[11px] uppercase">
                        {item.mediaType === 'tv' ? (t('series') || 'Сериал') : (t('movies') || 'Фильм')}
                      </span>
                      {item.rating > 0 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 font-extrabold flex items-center gap-1 text-[11px]">
                          ⭐ {item.rating}
                        </span>
                      )}
                      {item.year && (
                        <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-gray-300 font-semibold text-[11px]">
                          {item.year}
                        </span>
                      )}
                      {item.genreNames.map(g => (
                        <span key={g} className="px-1.5 py-0.5 rounded-md bg-white/5 text-gray-400 font-medium text-[11px]">
                          {g}
                        </span>
                      ))}
                    </div>

                    {/* Title */}
                    <h3 className="text-base sm:text-lg font-bold text-white leading-tight drop-shadow-md pr-16">
                      {item.title}
                    </h3>
                    {item.originalTitle && item.originalTitle !== item.title && (
                      <p className="text-xs text-gray-400 font-medium italic -mt-1 drop-shadow pr-16">
                        {item.originalTitle}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Loading more indicator */}
        {isLoadingMore && (
          <div className="w-full py-4 flex items-center justify-center gap-2 text-gray-400 text-xs font-semibold">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <span>{t('loading') || 'Загрузка следующих трейлеров...'}</span>
          </div>
        )}
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 bg-black/98 flex flex-col items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
        {/* Floating Close Button */}
        <button
          onClick={onClose}
          className="fixed top-4 right-4 z-50 w-11 h-11 rounded-full bg-black/80 hover:bg-gray-800 text-white flex items-center justify-center text-xl font-bold border border-white/20 shadow-2xl transition-transform active:scale-90 backdrop-blur-md"
          title="Закрыть"
          aria-label="Закрыть"
        >
          ✕
        </button>
        {content}
      </div>
    );
  }

  return content;
};
