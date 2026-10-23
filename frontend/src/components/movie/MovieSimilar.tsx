import React, { useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { AvailBadge } from '../AvailBadge';
import { prewarmStream } from '../../utils/streamPreloader';

export interface MovieSimilarProps {
  recommendations: any[];
  hasMoreRecs: boolean;
  loadingMoreRecs: boolean;
  onLoadMore: () => void;
  onSelectMovie: (rec: any) => void;
  language: string;
}

export const MovieSimilar: React.FC<MovieSimilarProps> = ({
  recommendations,
  hasMoreRecs,
  loadingMoreRecs,
  onLoadMore,
  onSelectMovie,
  language,
}) => {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="relative border-t border-white/10 pt-4 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-bold text-xl">{t('recommendations')}</h2>
        <div className="flex gap-2">
          <button 
            onClick={() => scrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
            aria-label={t('prev') || 'Previous'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button 
            onClick={() => scrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
            aria-label={t('next') || 'Next'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex overflow-x-auto gap-4 pt-1 pb-6 snap-x scrollbar-thin">
        {recommendations.map((rec) => (
          <div 
            key={rec.id} 
            className="min-w-[140px] w-[140px] sm:min-w-[150px] sm:w-[150px] snap-start cursor-pointer active:scale-95 transition-transform group card-hover rounded-xl relative z-10" 
            onPointerDown={() => prewarmStream(rec.id, rec, language)}
            onClick={() => {
              prewarmStream(rec.id, rec, language);
              onSelectMovie(rec);
            }}
          >
            <div className="relative overflow-hidden rounded-xl w-full aspect-[2/3] shadow-sm bg-[var(--hint-color)]">
              <img 
                src={rec.poster} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                alt={rec.title}
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = 'https://placehold.co/300x450/242f3d/ffffff?text=No+Poster';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
              <AvailBadge type={rec.type} id={rec.id} className="absolute top-1.5 left-1.5 z-20" />
            </div>
            <p className="text-xs sm:text-sm mt-2 font-semibold truncate px-1 pb-1">{rec.title}</p>
          </div>
        ))}
        {hasMoreRecs && (
          <div 
            onClick={onLoadMore}
            className="min-w-[140px] w-[140px] sm:min-w-[150px] sm:w-[150px] aspect-[2/3] snap-start cursor-pointer active:scale-95 transition-transform rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center text-center p-3 gap-2 shrink-0 select-none shadow-sm"
            title={t('moreMovies') || 'Больше фильмов'}
          >
            <div className="w-10 h-10 rounded-full bg-blue-600/30 border border-blue-500/50 flex items-center justify-center text-lg">
              {loadingMoreRecs ? <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : '➕'}
            </div>
            <span className="text-xs font-bold text-white leading-tight">
              {t('moreMovies') || 'Больше фильмов'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
