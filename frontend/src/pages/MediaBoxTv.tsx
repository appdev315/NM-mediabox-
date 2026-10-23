import { useState, useEffect } from 'react';
import { 
  TV_CHANNELS, 
  type TvChannel, 
  getChannelScheduleState 
} from '../utils/tvSchedule';
import { MediaBoxTvPlayer } from '../components/MediaBoxTvPlayer';
import { getTmdbImageUrl } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';

export function MediaBoxTv() {
  const { t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState<'movies' | 'series'>('movies');
  const [activeChannel, setActiveChannel] = useState<TvChannel | null>(null);

  // Периодическое обновление информации об эфире в карточках каталога (раз в 15 секунд)
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  const filteredChannels = TV_CHANNELS.filter(ch => ch.category === activeCategory);

  return (
    <div 
      className="min-h-screen px-3 sm:px-4 pb-24 text-white"
      style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
    >
      {/* 1. Заголовок раздела */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">📺</span>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            {t('tv') || 'Медиабокс ТВ'}
          </h1>
          <span className="bg-red-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-full shadow-sm tracking-wider">
            LIVE 24/7
          </span>
        </div>
        <p className="text-xs text-white/60">
          Круглосуточный эфир топовых фильмов и сериалов по жанрам без рекламы
        </p>
      </div>

      {/* 2. Переключатель категорий: Фильмы / Сериалы */}
      <div className="flex items-center gap-2 mb-5 p-1 bg-white/5 rounded-2xl border border-white/10 max-w-md">
        <button
          type="button"
          onClick={() => setActiveCategory('movies')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeCategory === 'movies'
              ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>🎬</span>
          <span>Фильмы</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveCategory('series')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeCategory === 'series'
              ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>🍿</span>
          <span>Сериалы</span>
        </button>
      </div>

      {/* 3. Сетка каналов выбранной категории */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredChannels.map(channel => {
          const state = getChannelScheduleState(channel);
          const { currentItem, nextItem, formattedNextTime, progressPercent, formattedTimeRemaining } = state;
          const isSeries = currentItem.type === 'tv';

          return (
            <div
              key={channel.id}
              onClick={() => setActiveChannel(channel)}
              className="group relative rounded-2xl bg-[#17212b]/80 border border-white/10 hover:border-white/20 p-3.5 flex flex-col gap-3 shadow-xl transition-all active:scale-[0.99] cursor-pointer overflow-hidden backdrop-blur-sm"
            >
              {/* Верхняя шапка канала с жанром и иконкой */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${channel.color} flex items-center justify-center text-base shadow`}>
                    {channel.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white group-hover:text-amber-400 transition-colors leading-tight">
                      {channel.nameRu}
                    </h3>
                    <span className="text-[10px] text-white/50 font-medium">
                      {channel.genreNameRu}
                    </span>
                  </div>
                </div>

                {/* Индикатор прямого эфира */}
                <span className="flex items-center gap-1 text-[10px] font-black tracking-wider text-red-500 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  ЭФИР
                </span>
              </div>

              {/* Тело карточки: постер, текущий фильм/серия и таймлайн */}
              <div className="flex gap-3">
                <div className="relative w-16 h-24 rounded-xl overflow-hidden bg-white/5 shrink-0 shadow border border-white/5">
                  <img
                    src={getTmdbImageUrl(currentItem.posterPath, 'w154')}
                    alt={currentItem.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-1">
                    <span className="text-[9px] font-mono font-bold text-white/90">
                      {currentItem.year}
                    </span>
                  </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                  <div>
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
                      Сейчас в эфире:
                    </span>
                    <h4 className="font-bold text-xs text-white truncate group-hover:text-amber-300 transition-colors mt-0.5">
                      {currentItem.title}
                    </h4>
                    {isSeries && currentItem.season && (
                      <p className="text-[11px] text-indigo-300 font-medium truncate">
                        Сезон {currentItem.season}, Серия {currentItem.episode}
                      </p>
                    )}
                    <p className="text-[10px] text-white/50 truncate mt-0.5">
                      {formattedTimeRemaining}
                    </p>
                  </div>

                  {/* Мини-прогресс эфира текущего тайтла */}
                  <div className="space-y-1">
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-red-500 rounded-full"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Нижняя строчка: следующая передача */}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 truncate text-white/70">
                  <span className="text-[10px] font-bold uppercase text-white/40">Далее:</span>
                  <span className="font-medium text-white/90 truncate">
                    {nextItem.title} {nextItem.episode ? `(S${nextItem.season}E${nextItem.episode})` : ''}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-400/80 shrink-0 ml-2">
                  в {formattedNextTime}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. Полноэкранный плеер выбранного канала */}
      {activeChannel && (
        <MediaBoxTvPlayer
          channel={activeChannel}
          onClose={() => setActiveChannel(null)}
          onSelectChannel={(newCh) => setActiveChannel(newCh)}
          allChannels={filteredChannels}
        />
      )}
    </div>
  );
}
export default MediaBoxTv;
