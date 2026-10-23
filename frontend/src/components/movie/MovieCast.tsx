import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { getTmdbImageUrl } from '../../hooks/useApi';

export interface MovieCastProps {
  cast: any[];
  allCastLength: number;
  showAllCast: boolean;
  onToggleShowAllCast: () => void;
  onSelectPerson: (id: number) => void;
}

export const MovieCast: React.FC<MovieCastProps> = ({
  cast,
  allCastLength,
  showAllCast,
  onToggleShowAllCast,
  onSelectPerson,
}) => {
  const { t } = useLanguage();

  if (!cast || cast.length === 0) return null;

  return (
    <div className="mb-8 border-t border-white/10 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-extrabold text-base">{t('topCast')}</h3>
        {allCastLength > 6 && (
          <button
            onClick={onToggleShowAllCast}
            className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
          >
            {showAllCast ? (t('showLess') || 'Свернуть') : `${t('showMore')} (${allCastLength})`}
          </button>
        )}
      </div>
      <div className="flex overflow-x-auto gap-3 pt-1 pb-4 scrollbar-thin">
        {cast.map((actor: any) => (
          <div
            key={actor.id}
            onClick={() => onSelectPerson(actor.id)}
            className="w-24 min-w-[96px] cursor-pointer group space-y-1 text-center"
          >
            <img
              src={actor.profile_path ? getTmdbImageUrl(actor.profile_path, 'w185') : 'https://placehold.co/185x278/242f3d/ffffff?text=No+Photo'}
              alt={actor.name}
              className="w-24 aspect-[2/3] object-cover rounded-xl shadow group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
            />
            <p className="text-xs font-bold truncate group-hover:text-blue-400 transition-colors pb-0.5">
              {actor.name}
            </p>
            <p className="text-[10px] opacity-60 truncate pb-0.5">
              {actor.character}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
