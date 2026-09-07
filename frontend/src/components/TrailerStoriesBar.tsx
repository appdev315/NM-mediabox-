import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useApi, type TrailerFeedItem } from '../hooks/useApi';
import { getViewedTrailerIds, markTrailerAsViewed, prioritizeUnviewedTrailers } from './TrailerFeed';
import { WebApp } from '../telegram';

interface TrailerStoriesBarProps {
  onOpenFeed: (trailerId?: number, index?: number) => void;
}

export const TrailerStoriesBar: React.FC<TrailerStoriesBarProps> = ({ onOpenFeed }) => {
  const { t } = useLanguage();
  const { fetchTrailerFeed } = useApi();
  const [items, setItems] = useState<TrailerFeedItem[]>([]);
  const [viewedSet, setViewedSet] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    fetchTrailerFeed(1)
      .then(fetched => {
        if (!isMounted) return;
        const prioritized = prioritizeUnviewedTrailers(fetched, true);
        setItems(prioritized);
        setViewedSet(getViewedTrailerIds());
      })
      .catch(err => {
        console.error('Failed to load stories trailers:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [fetchTrailerFeed]);

  // Refresh viewed state when window gains focus, storage changes, or mb_trailer_viewed fires
  useEffect(() => {
    const updateViewed = () => setViewedSet(getViewedTrailerIds());
    window.addEventListener('focus', updateViewed);
    window.addEventListener('storage', updateViewed);
    window.addEventListener('mb_trailer_viewed', updateViewed);
    return () => {
      window.removeEventListener('focus', updateViewed);
      window.removeEventListener('storage', updateViewed);
      window.removeEventListener('mb_trailer_viewed', updateViewed);
    };
  }, []);

  const handleCardClick = (trailerId?: number, idx: number = 0) => {
    if (WebApp.HapticFeedback) {
      WebApp.HapticFeedback.impactOccurred('medium');
    }
    if (trailerId) {
      markTrailerAsViewed(trailerId);
      setViewedSet(prev => new Set(prev).add(trailerId));
    }
    onOpenFeed(trailerId, idx);
  };

  if (loading && items.length === 0) {
    return (
      <div className="w-full mb-4">
        <div className="flex gap-3 overflow-x-auto hide-scrollbar py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="w-24 sm:w-28 h-36 sm:h-40 rounded-2xl bg-gray-800/60 animate-pulse flex-shrink-0 border border-white/5"
            />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="w-full mb-4">
      {/* Section Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-extrabold text-white tracking-wide">
            {t('trailersTab') || 'Что глянуть?'}
          </span>
        </div>
      </div>

      {/* Horizontal Stories Carousel */}
      <div className="flex gap-2.5 sm:gap-3 overflow-x-auto hide-scrollbar py-1 px-1">
        {/* Card 0: "Все трейлеры" Special Hero Story Card */}
        <div
          onClick={() => handleCardClick(undefined, 0)}
          className="relative w-24 sm:w-28 h-36 sm:h-40 rounded-2xl p-2.5 flex flex-col justify-between overflow-hidden cursor-pointer flex-shrink-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 shadow-xl shadow-blue-500/20 border-2 border-indigo-400/80 transition-transform active:scale-95 hover:scale-[1.02] duration-150"
        >
          <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-base border border-white/30 shadow-md">
            🎬
          </div>
          <div>
            <div className="w-7 h-7 rounded-full bg-white text-indigo-600 flex items-center justify-center text-xs font-black shadow-lg mb-1.5 pl-0.5">
              ▶
            </div>
            <p className="text-xs font-black text-white leading-tight drop-shadow">
              {t('watchAll') || 'Смотреть все'}
            </p>
          </div>
        </div>

        {/* Stories Cards */}
        {items.map((item, index) => {
          const isViewed = viewedSet.has(item.id);

          return (
            <div
              key={`${item.id}-${index}`}
              onClick={() => handleCardClick(item.id, index)}
              className={`relative w-24 sm:w-28 h-36 sm:h-40 rounded-2xl overflow-hidden cursor-pointer flex-shrink-0 transition-all active:scale-95 hover:scale-[1.02] duration-150 bg-gray-900 border-2 ${
                isViewed
                  ? 'border-white/10 opacity-70'
                  : 'border-blue-500 shadow-lg shadow-blue-500/25 ring-2 ring-blue-500/40'
              }`}
            >
              {/* Background Poster Image */}
              <img
                src={item.poster || item.backdrop}
                alt={item.title}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
              />

              {/* Gradient Darkening Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/20 pointer-events-none" />

              {/* Top Meta: Rating or New Badge */}
              <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between pointer-events-none">
                {item.rating > 0 ? (
                  <span className="px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-black text-yellow-400 flex items-center gap-0.5">
                    ⭐ {item.rating}
                  </span>
                ) : <span />}

                {!isViewed && (
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                )}
              </div>

              {/* Center Play Icon on Hover / Idle */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-md border border-white/30 text-white flex items-center justify-center text-xs pl-0.5 shadow-lg">
                  ▶
                </div>
              </div>

              {/* Bottom Title */}
              <div className="absolute bottom-1.5 left-1.5 right-1.5 pointer-events-none">
                <p className="text-[11px] font-bold text-white leading-tight line-clamp-2 drop-shadow-md">
                  {item.title}
                </p>
                {item.year && (
                  <p className="text-[9px] text-gray-300 font-medium drop-shadow mt-0.5">
                    {item.year}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
