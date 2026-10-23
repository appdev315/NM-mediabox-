import { useState, useEffect, useRef, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { WebApp } from '../telegram';
import { Player } from './Player';
import { CF_API_BASE, getTmdbImageUrl } from '../hooks/useApi';
import { clientCache } from '../utils/clientCache';
import { useLanguage } from '../context/LanguageContext';
import { 
  type TvChannel, 
  type ChannelScheduleState, 
  getChannelScheduleState, 
  getChannelUpcomingSchedule,
  formatTimecode,
  getItemTitle,
  getChannelName
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
  const { t, language } = useLanguage();

  // Вычисление моментального состояния эфира канала (10 слотов по 144 мин)
  const [scheduleState, setScheduleState] = useState<ChannelScheduleState>(() => 
    getChannelScheduleState(channel)
  );

  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(true);
  const [streamError, setStreamError] = useState(false);
  // Состояние активного воспроизведения прямого эфира:
  // До старта (false) клик передается в донорский плеер для снятия блокировки автоплея браузера со звуком.
  // После старта (true) опускается защитный экран, блокирующий паузу и сохраняющий непрерывный живой эфир.
  const [isLivePlaying, setIsLivePlaying] = useState(false);

  // Сброс статуса воспроизведения при переключении канала или слота передачи
  useEffect(() => {
    setIsLivePlaying(false);
  }, [channel.id, scheduleState.slotIndex]);

  // Напоминание о возможности переключения дорожки звука в плеере (на 7 секунд)
  const [showAudioBadge, setShowAudioBadge] = useState(true);

  useEffect(() => {
    setShowAudioBadge(true);
    const timer = setTimeout(() => {
      setShowAudioBadge(false);
    }, 7000);
    return () => clearTimeout(timer);
  }, [channel.id, scheduleState.slotIndex]);

  // Состояние видимости OSD: полностью скрывается при отсутствии активности
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef<any>(null);

  // Состояние полноэкранного режима плеера
  const [isFullscreen, setIsFullscreen] = useState(() => {
    return Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
  });

  // Переключение полноэкранного режима браузера / контейнера
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        const root = document.documentElement;
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if ((root as any).webkitRequestFullscreen) {
          await (root as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('[MediaBoxTv] Ошибка переключения полноэкранного режима:', err);
    }
  }, []);

  // Слушатель системных событий перехода в/из полноэкранного режима
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

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

  // 2. ЗАЩИТА ОТ ПАУЗЫ (Anti-Pause Watchdog) И ДЕТЕКЦИЯ СТАРТА ЭФИРА:
  // При первом событии воспроизведения опускается защитный экран, блокирующий клики паузы
  useEffect(() => {
    let clickTimer: any = null;

    const handleTvMessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (!data) return;

        // Фиксация старта прямого эфира: донор начал проигрывание потока
        if (
          data.event === 'startWatching' || 
          data.event === 'viewProgress' || 
          data.event === 'play' || 
          data.event === 'timeupdate' ||
          data.event === 'adStart'
        ) {
          setIsLivePlaying(true);
        }

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

    // Детекция первого физического клика по незащищенному iframe:
    // Когда пользователь кликает по нативному Play донора, фокус окна уходит на iframe.
    // С безопасным дебаунсом 300мс активируем завесу, защищающую от последующих нажатий на паузу.
    const handleWindowBlur = () => {
      clickTimer = setTimeout(() => {
        const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
        if (document.activeElement === ifr || document.activeElement?.tagName === 'IFRAME') {
          setIsLivePlaying(true);
        }
      }, 300);
    };

    window.addEventListener('message', handleTvMessage);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('message', handleTvMessage);
      window.removeEventListener('blur', handleWindowBlur);
      if (clickTimer) clearTimeout(clickTimer);
    };
  }, []);

  // 3. ОПТИМИЗАЦИЯ CPU (SLEEP MODE ДЛЯ ТАЙМЕРА):
  // Таймер 1 сек работает ИСКЛЮЧИТЕЛЬНО пока открыто OSD (isControlsVisible === true).
  // Когда OSD скрыто, таймер спит и расходует 0.0% CPU!
  useEffect(() => {
    if (!isControlsVisible) return;

    // Синхронизируем состояние немедленно при пробуждении OSD
    setScheduleState(getChannelScheduleState(channel));

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
  }, [channel, isControlsVisible]);

  // 4. ТОЧНЫЙ ТАЙМЕР ПЕРЕКЛЮЧЕНИЯ ТАЙТЛА (КОГДА OSD СПИТ):
  // Вычисляем миллисекунды до конца текущего тайтла эфира (remainingSec) и взводим одиночный setTimeout
  useEffect(() => {
    const msToNext = Math.max(1000, scheduleState.remainingSec * 1000);

    const slotTimer = setTimeout(() => {
      setScheduleState(getChannelScheduleState(channel));
    }, msToNext);

    return () => clearTimeout(slotTimer);
  }, [channel, scheduleState.currentItem.id, scheduleState.remainingSec]);

  // 5. СИНХРОНИЗАЦИЯ СЕТКИ ПРИ ПРОБУЖДЕНИИ ВКЛАДКИ (Page Visibility API):
  // При возврате пользователя из другой вкладки или после разблокировки экрана
  // моментально обновляем расписание до точной текущей секунды
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setScheduleState(getChannelScheduleState(channel));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
          original_title: currentItem.origin_title || '',
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
      className={
        isFullscreen
          ? "fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden"
          : "fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-6 select-none overflow-hidden"
      }
      onClick={isFullscreen ? triggerUserActivity : onClose}
      onMouseMove={triggerUserActivity}
      onTouchStart={triggerUserActivity}
    >
      {/* Обертка для оконного режима: объединяет плеер и правый сайдбар на десктопе */}
      <div 
        className={
          isFullscreen
            ? "w-full h-full flex flex-col"
            : "relative w-full max-w-6xl xl:max-w-7xl flex flex-col lg:flex-row items-center lg:items-stretch justify-center gap-4 max-h-[92vh]"
        }
      >
        {/* Колонка плеера: включает плашку звука сверху и плашку «ДАЛЕЕ» снизу в вертикальном/оконном режиме */}
        <div className={isFullscreen ? "w-full h-full flex flex-col" : "flex-1 w-full flex flex-col items-center justify-center max-w-full"}>
          
          {/* Вспомогательный Smart Audio Badge над плеером в вертикальном/оконном режиме со стрелкой на шестеренку */}
          {showAudioBadge && !isLoadingStream && !streamError && !isFullscreen && (
            <div className="w-full flex justify-end pb-2 pointer-events-auto">
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAudioBadge(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white text-[11px] sm:text-xs font-bold shadow-xl border border-white/20 cursor-pointer backdrop-blur-md select-none animate-pulse"
                title={t('clickToHide') || 'Нажмите, чтобы скрыть'}
              >
                <span>🎧 {t('audioLanguageHint') || 'Переключи язык аудио здесь'}</span>
                <span className="text-amber-300 font-black text-sm shrink-0">↘️</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAudioBadge(false);
                  }}
                  className="ml-1 text-white/70 hover:text-white text-xs font-bold p-0.5 shrink-0 cursor-pointer"
                  aria-label={t('close') || 'Закрыть'}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* 1. Контейнер видеоплеера: в оконном режиме flex-1 aspect-video, в полноэкранном — 100% viewport */}
          <div 
            className={
              isFullscreen
                ? "relative w-full h-full flex flex-col bg-black overflow-hidden"
                : "relative w-full aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/15 bg-black flex flex-col"
            }
            onClick={(e) => {
              e.stopPropagation();
              triggerUserActivity();
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
          >
            {/* 2. Верхний скрывающийся OSD-бар: Кнопка Назад, Название канала, Программа передач */}
            {/* Контейнер pointer-events-none: клики по правому верхнему углу свободно проходят в iframe к нативной шестеренке */}
            <div 
              className={`absolute top-0 left-0 right-0 z-40 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 pointer-events-none ${
                isControlsVisible ? 'opacity-100' : 'opacity-0'
              }`}
              style={isFullscreen ? { paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' } : undefined}
            >
              {/* Слева: только круглая кнопка закрытия ✕. Левый верхний угол остаётся свободным под заголовок фильма донора */}
              <div className="flex items-center pointer-events-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all cursor-pointer backdrop-blur-md border border-white/10"
                  aria-label={t('tvBackToChannels')}
                >
                  ✕
                </button>
              </div>

              {/* По центру: плавающая полупрозрачная капсула с названием канала и бейджем ЭФИР */}
              <div className="pointer-events-auto flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-lg">
                <span className="font-bold text-white text-xs sm:text-sm tracking-wide truncate max-w-[130px] sm:max-w-xs">
                  {getChannelName(channel, language)}
                </span>
                <span className="inline-flex items-center gap-1 bg-red-600 text-white text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded shadow tracking-wider shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  {t('tvLive')}
                </span>
              </div>

              {/* Справа: Пустой прозрачный угол под шестеренку донора (аудиодорожки, субтитры, качество) */}
              <div className="w-16 h-10 pointer-events-none" />
            </div>

            {/* 3. Рабочая область плеера с защитным экраном против паузы */}
            <div className="relative flex-1 w-full h-full flex items-center justify-center bg-black overflow-hidden">
              {isLoadingStream && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black gap-3 text-white">
                  <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-medium text-white/80 tracking-wide">
                    {t('tvConnecting')}
                  </span>
                </div>
              )}

              {streamError && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black gap-4 p-6 text-center text-white">
                  <div className="w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center text-white/70 font-bold text-xl">
                    !
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-lg">{t('tvStreamUnavailable')}</h3>
                    <p className="text-xs text-white/60 max-w-sm">
                      {t('tvStreamUnavailableDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextChannel = allChannels.find(c => c.id !== channel.id) || allChannels[0];
                      onSelectChannel(nextChannel);
                    }}
                    className="px-4 py-2 rounded-xl bg-amber-500 text-black font-bold text-xs shadow-lg active:scale-95 transition-all cursor-pointer"
                  >
                    {t('tvNextChannel')}
                  </button>
                </div>
              )}

              {/* Адаптивный видеофрейм 16:9 (max-w-full max-h-full aspect-video) без обрезки краев на экранах любого формата */}
              <div className="relative w-full h-full max-w-full max-h-full aspect-video flex items-center justify-center overflow-hidden">
                {/* Видеоплеер с уникальным ключом для детерминированного перемонтирования при смене фильма или серии */}
                {iframeUrl && !streamError && (
                  <Player
                    key={`${currentItem.id}_${currentItem.type}_${currentItem.season || ''}_${currentItem.episode || ''}_${scheduleState.slotIndex}`}
                    iframeUrl={iframeUrl}
                    initialTimecode={initialTimecode}
                    targetEpisode={isSeries && currentItem.season ? { season: currentItem.season, episode: currentItem.episode || '1' } : undefined}
                  />
                )}

                {/* 5. ЭКРАН ЗАЩИТЫ ОТ ПАУЗЫ (100% No-Pause Video Shield): */}
                {/* До старта воспроизведения (isLivePlaying = false) клики свободно проходят в плеер для снятия блока автоплея. */}
                {/* После старта (isLivePlaying = true) экран перехватывает клики и будит OSD, не позволяя поставить живой эфир на паузу. */}
                {/* А. Левая и центральная часть экрана (открыт правый верхний угол ~240-280px для шестеренки и меню) */}
                <div 
                  className={`absolute top-0 bottom-0 left-0 right-[240px] sm:right-[280px] z-20 bg-transparent ${
                    isLivePlaying ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerUserActivity();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                />

                {/* Б. Правая нижняя часть экрана (ниже выпадающего меню настроек 260-300px) */}
                <div 
                  className={`absolute top-[260px] sm:top-[300px] bottom-0 right-0 w-[240px] sm:w-[280px] z-20 bg-transparent ${
                    isLivePlaying ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerUserActivity();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                />
                {/* Правый верхний угол (~240-280px x 260-300px) ОСТАЁТСЯ ОТКРЫТЫМ: */}
                {/* Мышь свободно передается в iframe (донор не прячет шестеренку), а клики попадают в пункты меню (дорожки, субтитры) */}

                {/* 5. Защитный глухой блэкаут-экран над нижней панелью донора: */}
                {/* На 100% глухо скрывает донорский таймлайн, кнопку паузы и громкость строго на поверхности видео */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-[48px] sm:h-[70px] z-30 cursor-default bg-black pointer-events-auto shadow-[0_-8px_16px_rgba(0,0,0,0.9)]"
                  title={t('tvLive')}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerUserActivity();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                />
              </div>

              {/* 6. СКРЫВАЮЩИЙСЯ НИЖНИЙ ИНФОРМАЦИОННЫЙ OSD-БАР НАД ТАЙМИНГОМ */}
              {/* Полностью исчезает (opacity-0) при неактивности — экран остаётся на 100% чистым */}
              <div 
                className={`absolute bottom-0 left-0 right-0 z-40 px-4 py-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity duration-300 pointer-events-none ${
                  isControlsVisible ? 'opacity-100' : 'opacity-0'
                }`}
                style={isFullscreen ? { paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' } : undefined}
              >
                {/* Информационная строка над полосой прогресса: чистый эфир без нагромождения */}
                <div className="flex items-center justify-between text-xs text-white font-medium mb-1.5 drop-shadow">
                  {/* Текущий статус эфира и таймкод */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex items-center gap-1 font-bold text-red-500 tracking-wide shrink-0">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />
                      {t('tvNowOnAir')}
                    </span>
                    <span className="text-white font-semibold truncate max-w-[170px] sm:max-w-md">
                      {getItemTitle(currentItem, language)}
                      {isSeries && currentItem.season ? ` (S${currentItem.season}E${currentItem.episode})` : ''}
                    </span>
                    <span className="text-white/60 text-[11px] font-mono shrink-0">
                      ({formatTimecode(elapsedSec)} / {formatTimecode(durationSec)})
                    </span>
                  </div>

                  {/* Справа: Собственная кнопка во весь экран */}
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFullscreen();
                        triggerUserActivity();
                      }}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center transition-all cursor-pointer pointer-events-auto border border-white/10 backdrop-blur-md shrink-0"
                      title={t('tvFullscreen')}
                      aria-label={t('tvFullscreen')}
                    >
                      {isFullscreen ? (
                        <span className="text-sm font-bold">✕</span>
                      ) : (
                        <span className="text-base font-bold leading-none">⛶</span>
                      )}
                    </button>
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
          </div>

          {/* Плашка «ДАЛЕЕ» вынесена под плеер в вертикальном/оконном положении; в горизонтальном/полноэкранном режиме отсутствует */}
          {!isFullscreen && (
            <div 
              onClick={(e) => e.stopPropagation()}
              className="w-full mt-3 px-4 py-2.5 rounded-xl bg-[#141b22]/90 backdrop-blur-xl border border-white/10 flex items-center justify-between text-xs text-white shadow-lg pointer-events-auto"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px] px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20 shrink-0">
                  {t('tvNext')}
                </span>
                <span className="font-semibold text-white truncate text-xs sm:text-sm">
                  {getItemTitle(nextItem, language)} {nextItem.episode ? `(S${nextItem.season}E${nextItem.episode})` : ''}
                </span>
              </div>
              <span className="text-amber-300 font-mono text-xs font-bold shrink-0 ml-3">
                {t('tvAt')} {formattedNextTime}
              </span>
            </div>
          )}
        </div>

        {/* 7. Внешний сайдбар программы передач: строго при !isFullscreen и только на десктопе (hidden lg:flex) */}
        {!isFullscreen && (
          <aside 
            className="hidden lg:flex w-80 xl:w-96 rounded-2xl bg-[#141b22]/90 backdrop-blur-xl border border-white/10 p-4 flex-col gap-3 shadow-2xl overflow-hidden shrink-0 self-stretch"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-bold text-white text-sm">{getChannelName(channel, language)}</h3>
                <span className="text-[11px] text-white/50">{t('tvScheduleToday')}</span>
              </div>
            </div>

            {/* Список непрерывных тайтлов эфира с точным астрономическим временем старта */}
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
                    alt={getItemTitle(sched.item, language)} 
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
                          • {t('tvLive')}
                        </span>
                      )}
                    </div>
                    <h4 className="font-semibold text-xs text-white truncate mt-0.5">
                      {getItemTitle(sched.item, language)}
                    </h4>
                    <p className="text-[10px] text-white/50 truncate">
                      {sched.item.episodeTitle || `${sched.item.year} • ${Math.round(sched.item.durationSec / 60)} min`}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Быстрое переключение других каналов */}
            <div className="border-t border-white/10 pt-3">
              <span className="text-[11px] font-bold text-white/60 uppercase tracking-wider block mb-2">
                {t('tvOtherChannels')}
              </span>
              <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                {allChannels.map(ch => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => onSelectChannel(ch)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all border cursor-pointer ${
                      ch.id === channel.id 
                        ? 'bg-white text-black border-white' 
                        : 'bg-white/5 text-white border-white/10 hover:bg-white/15'
                    }`}
                  >
                    <span>{getChannelName(ch, language)}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
