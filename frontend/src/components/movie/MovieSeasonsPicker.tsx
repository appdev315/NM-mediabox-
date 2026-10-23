import React, { useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';

export interface MovieSeasonsPickerProps {
  sortedSeasons: string[];
  activeSeason: string;
  sortedEpisodes: string[];
  activeEpisode: string;
  onSeasonChange: (season: string) => void;
  onEpisodeSelect: (episode: string) => void;
  getEpisodeReleaseStatus: (episode: string) => { isReleased: boolean; releaseDate?: string };
}

export const MovieSeasonsPicker: React.FC<MovieSeasonsPickerProps> = ({
  sortedSeasons,
  activeSeason,
  sortedEpisodes,
  activeEpisode,
  onSeasonChange,
  onEpisodeSelect,
  getEpisodeReleaseStatus,
}) => {
  const { t } = useLanguage();
  const episodesScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mb-8">
      <h3 className="font-bold text-lg mb-3">{t('seasonsAndEpisodes') || 'Сезоны и серии'}</h3>
      <div className="flex flex-col gap-3 mb-4">
        {/* Dropdown выбора сезона */}
        <div className="w-full sm:w-64 relative">
          <select
            value={activeSeason || sortedSeasons[0] || '1'}
            onChange={(e) => onSeasonChange(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl appearance-none outline-none font-bold shadow-sm cursor-pointer border border-transparent focus:border-[var(--button-color)] transition-all"
            style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
          >
            {sortedSeasons.map((season: string) => (
              <option key={season} value={season} className="bg-[var(--bg-color)] text-[var(--text-color)]">
                {t('season')} {season}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-50">▼</div>
        </div>

        {/* Интерактивные чипсы серий с плавной прокруткой стрелками на десктопе */}
        <div className="mt-1 relative group/ep">
          <button
            type="button"
            onClick={() => { episodesScrollRef.current?.scrollBy({ left: -240, behavior: 'smooth' }); }}
            className="hidden md:flex absolute left-0 top-0 bottom-2 z-10 items-center justify-center w-8 bg-gradient-to-r from-[var(--bg-color)] via-[var(--bg-color)]/80 to-transparent opacity-0 group-hover/ep:opacity-100 transition-opacity cursor-pointer"
            aria-label="Scroll left"
          >
            <span className="text-white/70 text-lg font-bold">◀</span>
          </button>
          
          <div ref={episodesScrollRef} className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none scroll-smooth md:px-8">
            {sortedEpisodes.map((episode: string) => {
              const isActive = (activeEpisode || sortedEpisodes[0] || '1') === episode;
              const { isReleased, releaseDate } = getEpisodeReleaseStatus(episode);

              if (!isReleased) {
                return (
                  <button
                    key={episode}
                    type="button"
                    disabled
                    className="px-3.5 py-1.5 rounded-xl text-xs font-medium flex-shrink-0 opacity-55 cursor-not-allowed bg-white/5 text-gray-400 border border-white/10 flex flex-col items-center justify-center select-none min-w-[76px]"
                    title={releaseDate ? `${t('premiereDate') || 'Premiere'}: ${releaseDate}` : (t('comingSoon') || '...')}
                  >
                    <span className="font-bold text-xs">{t('episode')} {episode}</span>
                    <span className="text-[10px] text-amber-400/90 font-mono mt-0.5 tracking-tight font-semibold">
                      {releaseDate || (t('comingSoon') || '...')}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={episode}
                  type="button"
                  onClick={() => onEpisodeSelect(episode)}
                  className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex-shrink-0 transition-all active:scale-95 cursor-pointer shadow-sm ${
                    isActive
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-black shadow-amber-500/20 shadow-md font-black scale-105'
                      : 'bg-white/10 hover:bg-white/15 text-white/90 border border-white/10'
                  }`}
                >
                  {t('episode')} {episode}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => { episodesScrollRef.current?.scrollBy({ left: 240, behavior: 'smooth' }); }}
            className="hidden md:flex absolute right-0 top-0 bottom-2 z-10 items-center justify-center w-8 bg-gradient-to-l from-[var(--bg-color)] via-[var(--bg-color)]/80 to-transparent opacity-0 group-hover/ep:opacity-100 transition-opacity cursor-pointer"
            aria-label="Scroll right"
          >
            <span className="text-white/70 text-lg font-bold">▶</span>
          </button>
        </div>
      </div>
    </div>
  );
};
