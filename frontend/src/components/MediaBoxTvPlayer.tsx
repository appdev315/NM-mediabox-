import { useState, useEffect, useRef, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { WebApp } from '../telegram';
import { Player } from './Player';
import { CF_API_BASE, getTmdbImageUrl } from '../hooks/useApi';
import { clientCache } from '../utils/clientCache';
import { 
  type TvChannel, 
  type ChannelScheduleState, 
  getChannelScheduleState, 
  getChannelUpcomingSchedule,
  formatTimecode 
} from '../utils/tvSchedule';

interface MediaBoxTvPlayerProps {
  channel: TvChannel;
  onClose: () => void;
  onSelectChannel: (channel: TvChannel) => void;
  allChannels: TvChannel[];
}

export function MediaBoxTvPlayer({ 
  channel, 
  onClose, 
  onSelectChannel, 
  allChannels 
}: MediaBoxTvPlayerProps) {
  // Вычисление моментального состояния эфира канала (10 слотов по 144 мин)
  const [scheduleState, setScheduleState] = useState<ChannelScheduleState>(() => 
    getChannelScheduleState(channel)
  );

  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(true);
  const [streamError, setStreamError] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Состояние видимости OSD: полностью скрывается при отсутствии активности (НИКАКИХ ПОСТОЯННЫХ КНОПОК)
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef<any>(null);

  // Сброс таймера автоскрытия OSD при любом взаимодействии пользователя
  const triggerUserActivity = useCallback(() => {
    setIsControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      // Скрываем все элементы управления через 3.5 секунды неактивности
      setIsControlsVisible(false);
    }, 3500);
  }, []);

  // Первоначальный запуск таймера автоскрытия
  useEffect(() => {
    triggerUserActivity();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, [triggerUserActivity]);

  // 1. НАВИГАЦИЯ НАЗАД ВНЕ БРАУЗЕРА (Telegram WebApp, Android Capacitor, History Popstate)
  useEffect(() => {
    // А. Telegram WebApp BackButton в нативной шапке мессенджера
    try {
      if (WebApp && WebApp.BackButton) {
        WebApp.BackButton.show();
        WebApp.BackButton.onClick(onClose);
      }
    } catch (_) {}

    // Б. Аппаратная кнопка и свайп «Назад» на Android (Capacitor)
    let backListenerHandle: any = null;
    try {
      CapacitorApp.addListener('backButton', () => {
        onClose();
      }).then(handle => {
        backListenerHandle = handle;
      });
    } catch (_) {}

    // В. Нативный свайп iOS/Android и кнопка браузера через popstate
    try {
      window.history.pushState({ modal: 'tv-player' }, '');
    } catch (_) {}

    const handlePopState = () => {
      onClose();
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      try {
        if (WebApp && WebApp.BackButton) {
          WebApp.BackButton.offClick(onClose);
          WebApp.BackButton.hide();
        }
      } catch (_) {}

      if (backListenerHandle && typeof backListenerHandle.remove === 'function') {
        backListenerHandle.remove();
      }

      window.removeEventListener('popstate', handlePopState);
    };
  }, [onClose]);

  // 2. ЗАЩИТА ОТ ПАУЗЫ (Anti-Pause Watchdog): эфир воспроизводится непрерывно
  useEffect(() => {
    const handleTvMessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (!data) return;

        // Если донор встал на паузу от клавиатуры или клика — мгновенно продолжаем воспроизведение
        if (data.event === 'pause' || data.type === 'pause') {
          const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
          if (ifr && ifr.contentWindow) {
            ifr.contentWindow.postMessage({ event: 'play' }, '*');
            ifr.contentWindow.postMessage({ api: 'play' }, '*');
            ifr.contentWindow.postMessage({ command: 'play' }, '*');
          }
        }
      } catch (_) {}
    };

    window.addEventListener('message', handleTvMessage);
    return () => window.removeEventListener('message', handleTvMessage);
  }, []);

  // Периодическое обновление секунд таймлайна эфира (раз в секунду)
  useEffect(() => {
    const interval = setInterval(() => {
      setScheduleState(prevState => {
        const fresh = getChannelScheduleState(channel);
        if (fresh.currentItem.id !== prevState.currentItem.id || 
            fresh.currentItem.episode !== prevState.currentItem.episode ||
            fresh.slotIndex !== prevState.slotIndex) {
          return fresh;
        }
        return {
          ...fresh,
          elapsedSec: fresh.elapsedSec,
          progressPercent: fresh.progressPercent
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [channel]);

  // Подгрузка видеопотока из Liftw с обязательными параметрами autoplay и timecode
  useEffect(() => {
    let isCancelled = false;
    const { currentItem } = scheduleState;

    const loadStream = async () => {
      setIsLoadingStream(true);
      setStreamError(false);

      const cacheKey = `liftw_stream_v2_${currentItem.id}_${currentItem.type}`;
      const cached = clientCache.get<any>(cacheKey);
      if (cached && cached.iframe && !isCancelled) {
        setIframeUrl(cached.iframe);
        setIsLoadingStream(false);
        return;
      }

      try {
        const query = new URLSearchParams({
          tmdb: String(currentItem.id),
          type: currentItem.type === 'tv' ? 'tv' : 'movie',
          title: currentItem.title,
          year: currentItem.year
        });

        const res = await fetch(`${CF_API_BASE}/liftw?${query.toString()}`, {
          signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) throw new Error('Поток не найден');
        const data = await res.json() as any;

        if (data && data.iframe && !isCancelled) {
          clientCache.set(cacheKey, data, currentItem.type === 'tv' ? 86400 : 2592000);
          setIframeUrl(data.iframe);
          setIsLoadingStream(false);
        } else if (!isCancelled) {
          throw new Error('Пустой iframe');
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('[MediaBoxTv] Ошибка загрузки потока:', err);
          setStreamError(true);
          setIsLoadingStream(false);
        }
      }
    };

    loadStream();

    return () => {
      isCancelled = true;
    };
  }, [scheduleState.currentItem.id, scheduleState.currentItem.episode, scheduleState.slotIndex, channel.id]);

  const { currentItem, initialTimecode, nextItem, formattedNextTime, elapsedSec, durationSec, progressPercent } = scheduleState;
  const isSeries = currentItem.type === 'tv';

  return (
    <div 
      className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden"
      onMouseMove={triggerUserActivity}
      onClick={triggerUserActivity}
      onTouchStart={triggerUserActivity}
    >
      {/* 1. Верхний скрывающийся OSD-бар: Кнопка Назад, Название канала, Программа передач */}
      {/* Контейнер pointer-events-none: клики по правому верхнему углу свободно проходят в iframe к нативной шестеренке */}
      <div 
        className={`absolute top-0 left-0 right-0 z-40 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-300 pointer-events-none ${
          isControlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-3 pointer-events-auto">
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all cursor-pointer backdrop-blur-md border border-white/10"
            aria-label="Назад к каналам"
          >
            ✕
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xl">{channel.icon}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-base leading-tight tracking-wide">
                  {channel.nameRu}
                </span>
                <span className="inline-flex items-center gap-1 bg-red-600/90 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded shadow tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  ЭФИР
                </span>
              </div>
              <p className="text-xs text-white/70 truncate max-w-[170px] sm:max-w-xs">
                {currentItem.title} {isSeries && currentItem.season ? `(S${currentItem.season}E${currentItem.episode})` : ''}
              </p>
            </div>
          </div>

          {/* Кнопка вызова программы передач (смещена влево к информации о канале) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowGuide(prev => !prev);
              triggerUserActivity();
            }}
            className={`ml-2 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
              showGuide 
                ? 'bg-amber-500 text-black border-amber-400' 
                : 'bg-white/10 text-white border-white/10 hover:bg-white/20'
            }`}
          >
            <span>📋</span>
            <span className="hidden sm:inline">Программа</span>
          </button>
        </div>

        {/* Правый верхний угол шириной 140px оставляем полностью свободным для нативной шестерёнки плеера */}
        <div className="w-28 sm:w-36 h-10 pointer-events-none" />
      </div>

      {/* 2. Контейнер видеоплеера */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center bg-black overflow-hidden">
        {isLoadingStream && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black gap-3 text-white">
            <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium text-white/80 tracking-wide">
              Подключение к прямому эфиру...
            </span>
          </div>
        )}

        {streamError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black gap-4 p-6 text-center text-white">
            <span className="text-4xl">📡</span>
            <div className="space-y-1">
              <h3 className="font-bold text-lg">Поток временно недоступен</h3>
              <p className="text-xs text-white/60 max-w-sm">
                Трансляция «{currentItem.title}» восстанавливается донором. Попробуйте переключить канал или обновить эфир.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const nextChannel = allChannels.find(c => c.id !== channel.id) || allChannels[0];
                onSelectChannel(nextChannel);
              }}
              className="px-4 py-2 rounded-xl bg-amber-500 text-black font-bold text-xs shadow-lg active:scale-95 transition-all"
            >
              Следующий канал
            </button>
          </div>
        )}

        {iframeUrl && !streamError && (
          <Player
            iframeUrl={iframeUrl}
            initialTimecode={initialTimecode}
            targetEpisode={isSeries && currentItem.season ? { season: currentItem.season, episode: currentItem.episode || '1' } : undefined}
          />
        )}

        {/* Защита таймлайна прямого эфира: закрывает только нижнюю полосу перемотки (36px). */}
        {/* Клик по центру экрана свободно передается в iframe VenomPlayer для старта видео, */}
        {/* а правый угол (150px) остается открытым для выбора озвучки и полноэкранного режима. */}
        <div
          className="absolute bottom-0 left-0 right-[150px] h-[36px] z-30 cursor-default bg-transparent"
          title="Прямой эфир (перемотка отключена)"
          onClick={(e) => {
            e.stopPropagation();
            triggerUserActivity();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        />

        {/* 5. СКРЫВАЮЩИЙСЯ НИЖНИЙ ИНФОРМАЦИОННЫЙ OSD-БАР НАД ТАЙМИНГОМ */}
        {/* Полностью исчезает (opacity-0) при неактивности — экран остаётся на 100% чистым */}
        <div 
          className={`absolute bottom-0 left-0 right-0 z-40 px-4 py-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity duration-300 pointer-events-none ${
            isControlsVisible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          {/* Информационная строка над полосой прогресса */}
          <div className="flex items-center justify-between text-xs text-white font-medium mb-1.5 drop-shadow">
            {/* Текущий статус эфира и таймкод */}
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 font-bold text-red-500 tracking-wide">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />
                В ЭФИРЕ:
              </span>
              <span className="text-white font-semibold truncate max-w-[160px] sm:max-w-xs">
                {currentItem.title}
                {isSeries && currentItem.season ? ` (S${currentItem.season}E${currentItem.episode})` : ''}
              </span>
              <span className="text-white/60 text-[11px]">
                ({formatTimecode(elapsedSec)} / {formatTimecode(durationSec)})
              </span>
            </div>

            {/* В КОНЦЕ ЛИНИИ НАД ТАЙМИНГОМ: Следующий фильм или эпизод */}
            <div className="text-right text-[11px] text-white/90 flex items-center gap-1.5 ml-2">
              <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px]">Далее:</span>
              <span className="font-medium text-white truncate max-w-[140px] sm:max-w-sm">
                {nextItem.title} {nextItem.episode ? `(S${nextItem.season}E${nextItem.episode})` : ''}
              </span>
              <span className="text-amber-300/80 font-mono text-[10px]">в {formattedNextTime}</span>
            </div>
          </div>

          {/* Визуальная линия прогресса прямого эфира */}
          <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-red-600 rounded-full transition-all duration-1000 ease-linear shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 6. Всплывающая панель: Программа передач (EPG Drawer) */}
      {showGuide && (
        <div 
          className="absolute inset-y-0 right-0 w-full sm:w-96 z-50 bg-[#141b22]/95 backdrop-blur-xl border-l border-white/10 p-4 flex flex-col gap-3 shadow-2xl animate-in slide-in-from-right duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{channel.icon}</span>
              <div>
                <h3 className="font-bold text-white text-sm">{channel.nameRu}</h3>
                <span className="text-[11px] text-white/50">Программа на сегодня (10 передач)</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Список запланированных тайтлов на сутки */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 hide-scrollbar">
            {getChannelUpcomingSchedule(channel).map((sched) => (
              <div 
                key={`${sched.item.id}_${sched.item.episode || ''}_${sched.slotNum}`}
                className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                  sched.isCurrent 
                    ? 'bg-red-600/10 border-red-500/30 text-white' 
                    : 'bg-white/5 border-white/5 text-white/80 hover:bg-white/10'
                }`}
              >
                <img 
                  src={getTmdbImageUrl(sched.item.posterPath, 'w92')} 
                  alt={sched.item.title} 
                  className="w-10 h-14 rounded-lg object-cover bg-gray-800 shrink-0 shadow"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                      sched.isCurrent ? 'bg-red-600 text-white' : 'bg-white/10 text-white/70'
                    }`}>
                      {sched.formattedStartTime}
                    </span>
                    {sched.isCurrent && (
                      <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                        • В ЭФИРЕ
                      </span>
                    )}
                  </div>
                  <h4 className="font-semibold text-xs text-white truncate mt-0.5">
                    {sched.item.title}
                  </h4>
                  <p className="text-[10px] text-white/50 truncate">
                    {sched.item.episodeTitle || `${sched.item.year} г. • ${Math.round(sched.item.durationSec / 60)} мин`}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Быстрое переключение других каналов */}
          <div className="border-t border-white/10 pt-3">
            <span className="text-[11px] font-bold text-white/60 uppercase tracking-wider block mb-2">
              Другие каналы:
            </span>
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              {allChannels.map(ch => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    onSelectChannel(ch);
                    setShowGuide(false);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all border ${
                    ch.id === channel.id 
                      ? 'bg-white text-black border-white' 
                      : 'bg-white/5 text-white border-white/10 hover:bg-white/15'
                  }`}
                >
                  <span>{ch.icon}</span>
                  <span>{ch.nameRu}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
