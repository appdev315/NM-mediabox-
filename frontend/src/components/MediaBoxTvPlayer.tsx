import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
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
  getChannelName,
  TV_CHANNELS
} from '../utils/tvSchedule';

interface MediaBoxTvPlayerProps {
  channel: TvChannel;
  onClose: () => void;
  onSelectChannel: (channel: TvChannel) => void;
}

export function MediaBoxTvPlayer({ 
  channel, 
  onClose, 
  onSelectChannel
}: MediaBoxTvPlayerProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();

  // Каналы той же категории (ТВ-программа и переключение при недоступном потоке)
  const siblingChannels = useMemo(
    () => TV_CHANNELS.filter(ch => ch.category === channel.category),
    [channel.category]
  );

  // Вычисление моментального состояния эфира канала (10 слотов по 144 мин)
  const [scheduleState, setScheduleState] = useState<ChannelScheduleState>(() => 
    getChannelScheduleState(channel)
  );
  // Актуальная ссылка на состояние эфира для безопасного доступа внутри таймеров и обработчиков событий
  const scheduleStateRef = useRef(scheduleState);
  useEffect(() => {
    scheduleStateRef.current = scheduleState;
  }, [scheduleState]);

  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(true);
  const [streamError, setStreamError] = useState(false);
  // Состояние активного воспроизведения прямого эфира
  const [isLivePlaying, setIsLivePlaying] = useState(false);

  // Списки опций и текущие параметры потока из донорского плеера Liftw (player-venom)
  const [soundList, setSoundList] = useState<string[]>([]);
  const [currentSound, setCurrentSound] = useState<string>('');
  const [qualityList, setQualityList] = useState<string[]>([]);
  const [currentQuality, setCurrentQuality] = useState<string>('');
  const [ccList, setCcList] = useState<string[]>([]);
  const [currentCc, setCurrentCc] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'sound' | 'quality' | 'cc'>('sound');

  // Отправка команды изменения настроек в iframe донора Liftw через postMessage API
  const sendDonorSetting = useCallback((key: 'sound' | 'quality' | 'cc', value: string) => {
    try {
      const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
      if (ifr && ifr.contentWindow) {
        ifr.contentWindow.postMessage({ req: 'setting set', key, value }, '*');
      }
    } catch (_) {}
  }, []);

  // Запрос текущих списков настроек и активных значений из плеера Liftw
  const queryDonorSettings = useCallback(() => {
    try {
      const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
      if (ifr && ifr.contentWindow) {
        ['sound', 'quality', 'cc'].forEach((key) => {
          ifr.contentWindow!.postMessage({ req: 'setting ls', key }, '*');
          ifr.contentWindow!.postMessage({ req: 'setting get', key }, '*');
        });
      }
    } catch (_) {}
  }, []);

  // Сброс статуса воспроизведения и настроек при смене канала, тайтла или эпизода эфира
  useEffect(() => {
    setIsLivePlaying(false);
    setIsSettingsOpen(false);
    setSoundList([]);
    setCurrentSound('');
    setQualityList([]);
    setCurrentQuality('');
    setCcList([]);
    setCurrentCc('');
  }, [channel.id, scheduleState.currentItem.id, scheduleState.currentItem.season, scheduleState.currentItem.episode]);

  // Опрос доступных дорожек при готовности плеера.
  // ВАЖНО: шилд отныне активен С МОНТАЖА и не активируется по таймеру —
  // premature-армирование на 2.5с перекрывало пользователю кнопку Play донора на мобильном.
  const handlePlayerReady = useCallback(() => {
    queryDonorSettings();
  }, [queryDonorSettings]);

  // Напоминание о возможности переключения дорожки звука в плеере (на 7 секунд)
  const [showAudioBadge, setShowAudioBadge] = useState(true);

  useEffect(() => {
    setShowAudioBadge(true);
    const timer = setTimeout(() => {
      setShowAudioBadge(false);
    }, 7000);
    return () => clearTimeout(timer);
  }, [channel.id, scheduleState.currentItem.id, scheduleState.currentItem.episode]);

  // Состояние видимости OSD: полностью скрывается при отсутствии активности
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef<any>(null);

  // Состояние полноэкранного режима плеера (декларативный React Web Fullscreen)
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Переключение полноэкранного режима: фирменный фуллскрин Telegram или нативный браузерный.
  // Двойной вызов (WebApp + documentElement параллельно) устранён — второе API конфликтует с первым.
  const toggleFullscreen = useCallback(async () => {
    try {
      const nextState = !isFullscreen;
      setIsFullscreen(nextState);

      if (nextState) {
        if (WebApp && typeof WebApp.requestFullscreen === 'function') {
          try { WebApp.requestFullscreen(); } catch (_) {}
        } else {
          // Нативный вызов для обычных браузеров (десктоп / PWA)
          const root = document.documentElement;
          if (root.requestFullscreen) {
            await root.requestFullscreen();
          } else if ((root as any).webkitRequestFullscreen) {
            await (root as any).webkitRequestFullscreen();
          }
        }
      } else {
        if (WebApp && typeof WebApp.exitFullscreen === 'function') {
          try { WebApp.exitFullscreen(); } catch (_) {}
        } else if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          }
        }
      }
    } catch (err) {
      console.warn('[MediaBoxTv] Ошибка переключения полноэкранного режима:', err);
    }
  }, [isFullscreen]);

  // Слушатель выхода из полноэкранного режима (Esc на десктопе + событие Telegram fullscreenChanged)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFs = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (!isNativeFs && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // Telegram WebApp не триггерит document fullscreenchange — синхронизируемся по фирменному событию
    const handleTgFullscreen = () => {
      try { setIsFullscreen(Boolean((WebApp as any).isFullscreen)); } catch (_) {}
    };
    try {
      if (WebApp && typeof (WebApp as any).onEvent === 'function') {
        (WebApp as any).onEvent('fullscreenChanged', handleTgFullscreen);
      }
    } catch (_) {}

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      try {
        if (WebApp && typeof (WebApp as any).offEvent === 'function') {
          (WebApp as any).offEvent('fullscreenChanged', handleTgFullscreen);
        }
      } catch (_) {}
    };
  }, [isFullscreen]);

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

  // Тап по шилду: будим OSD и шлём команды воспроизведения в донора.
  // До старта эфира это ЕДИНСТВЕННЫЙ способ запуска (нативная кнопка Play донора недоступна),
  // после старта — страховка Anti-Pause при клавиатурной/внешней паузе.
  const handleShieldTap = useCallback(() => {
    triggerUserActivity();
    try {
      const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
      if (ifr && ifr.contentWindow) {
        ifr.contentWindow.postMessage({ event: 'play' }, '*');
        ifr.contentWindow.postMessage({ api: 'play' }, '*');
        ifr.contentWindow.postMessage({ command: 'play' }, '*');
      }
    } catch (_) {}
  }, [triggerUserActivity]);

  // Реакция OSD на фактический старт эфира: один раз показываем панель
  useEffect(() => {
    if (isLivePlaying) {
      triggerUserActivity();
    }
  }, [isLivePlaying, triggerUserActivity]);


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

  // 2. ЗАЩИТА ОТ ПАУЗЫ И ПЕРЕМОТКИ (Anti-Pause & Anti-Seek Watchdog):
  useEffect(() => {
    let clickTimer: any = null;

    const handleTvMessage = (e: MessageEvent) => {
      try {
        // Принимаем события только от нашего донорского iframe:
        // посторонние фреймы (реклама и т.п.) не должны управлять эфиром
        const donorFrame = document.querySelector<HTMLIFrameElement>('#video-iframe');
        if (!donorFrame || !donorFrame.contentWindow || e.source !== donorFrame.contentWindow) return;

        let data: any = e.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (_) {
            data = { event: data, type: data };
          }
        }
        if (!data || typeof data !== 'object') return;

        // Фиксация старта прямого эфира: донор начал проигрывание потока
        if (
          data.event === 'startWatching' || 
          data.event === 'viewProgress' || 
          data.event === 'play' || 
          data.event === 'playing' ||
          data.event === 'timeupdate' ||
          data.event === 'adStart' ||
          data.type === 'play' ||
          data.type === 'playing' ||
          data.type === 'timeupdate' ||
          data.status === 'play' ||
          data.action === 'play'
        ) {
          setIsLivePlaying(true);
        }

        // Запрос настроек при готовности плеера
        if (data.event === 'playerReady' || data.event === 'startWatching') {
          queryDonorSettings();
        }

        // Обработка списков настроек от плеера Liftw ('setting ls')
        if (data.event === 'setting ls') {
          if (data.key === 'sound' && Array.isArray(data.ls)) {
            setSoundList(data.ls);
            // Автоматическое восстановление сохраненной аудиодорожки (например, любимый перевод)
            try {
              const prefSound = localStorage.getItem('mediabox_pref_sound');
              if (prefSound && data.ls.includes(prefSound)) {
                sendDonorSetting('sound', prefSound);
              }
            } catch (_) {}
          } else if (data.key === 'quality' && Array.isArray(data.ls)) {
            setQualityList(data.ls);
          } else if (data.key === 'cc' && Array.isArray(data.ls)) {
            setCcList(data.ls);
          }
        }

        // Обработка активных выбранных значений из донора Liftw ('setting')
        if (data.event === 'setting') {
          if (data.key === 'sound' && typeof data.value === 'string') {
            setCurrentSound(data.value);
            try {
              localStorage.setItem('mediabox_pref_sound', data.value);
            } catch (_) {}
          } else if (data.key === 'quality' && typeof data.value === 'string') {
            setCurrentQuality(data.value);
          } else if (data.key === 'cc' && typeof data.value === 'string') {
            setCurrentCc(data.value);
          }
        }

        // Если донор встал на паузу от клавиатуры или внешнего клика — мгновенно продолжаем воспроизведение
        if (data.event === 'pause' || data.type === 'pause' || data.status === 'pause') {
          const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
          if (ifr && ifr.contentWindow) {
            ifr.contentWindow.postMessage({ event: 'play' }, '*');
            ifr.contentWindow.postMessage({ api: 'play' }, '*');
            ifr.contentWindow.postMessage({ command: 'play' }, '*');
          }
        }

        // Защита от попыток перемотки эфира (Anti-Seek Watchdog): немедленный возврат к реальному таймкоду
        if (data.event === 'seek' || data.event === 'seeking' || data.type === 'seek' || data.action === 'seek') {
          const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
          if (ifr && ifr.contentWindow) {
            const currentLiveSec = Math.floor(scheduleStateRef.current.elapsedSec);
            ifr.contentWindow.postMessage({ event: 'seek', time: currentLiveSec }, '*');
            ifr.contentWindow.postMessage({ api: 'seek', set: currentLiveSec }, '*');
            ifr.contentWindow.postMessage({ command: 'seek', time: currentLiveSec }, '*');
            ifr.contentWindow.postMessage({ event: 'play' }, '*');
          }
        }
      } catch (_) {}
    };

    // Детекция первого физического клика по незащищенному iframe на десктопе и Android
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
  }, [queryDonorSettings, sendDonorSetting]);

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
                  setIsSettingsOpen(true);
                  triggerUserActivity();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white text-[11px] sm:text-xs font-bold shadow-xl border border-white/20 cursor-pointer backdrop-blur-md select-none animate-pulse"
                title={t('clickToHide') || 'Нажмите, чтобы скрыть'}
              >
                <span>🎧 {t('audioLanguageHint') || 'Переключи язык аудио здесь'}</span>
                <span className="text-amber-300 font-black text-sm shrink-0">⚙️</span>
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
              <div className={`flex items-center ${isControlsVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
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
              <div className={`flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-lg ${isControlsVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
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
                <div className="absolute inset-0 z-[35] flex flex-col items-center justify-center bg-black gap-3 text-white">
                  <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-medium text-white/80 tracking-wide">
                    {t('tvConnecting')}
                  </span>
                </div>
              )}

              {streamError && (
                <div className="absolute inset-0 z-[35] flex flex-col items-center justify-center bg-black gap-4 p-6 text-center text-white">
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
                      const nextChannel = siblingChannels.find(c => c.id !== channel.id) || siblingChannels[0];
                      onSelectChannel(nextChannel);
                    }}
                    className="px-4 py-2 rounded-xl bg-amber-500 text-black font-bold text-xs shadow-lg active:scale-95 transition-all cursor-pointer"
                  >
                    {t('tvNextChannel')}
                  </button>
                </div>
              )}

              {/* Адаптивный видеофрейм 16:9 (max-w-full max-h-full aspect-video) без обрезки краев на экранах любого формата */}
              <div 
                className="relative w-full h-full max-w-full max-h-full aspect-video flex items-center justify-center overflow-hidden"
              >
                {/* Видеоплеер с уникальным ключом для детерминированного перемонтирования при смене фильма или серии */}
                {iframeUrl && !streamError && (
                  <Player
                    key={`${currentItem.id}_${currentItem.type}_${currentItem.season || ''}_${currentItem.episode || ''}_${scheduleState.slotIndex}`}
                    iframeUrl={iframeUrl}
                    initialTimecode={initialTimecode}
                    targetEpisode={isSeries && currentItem.season ? { season: currentItem.season, episode: currentItem.episode || '1' } : undefined}
                    isTv={true}
                    onReady={handlePlayerReady}
                  />
                )}

                {/* 5. ГЛУХОЙ ЭКРАН ЗАЩИТЫ ПРЯМОГО ЭФИРА — АКТИВЕН С МОНТАЖА, ВО ВСЕХ РЕЖИМАХ: */}
                {/* 100% тапов/кликов/свайпов не доходят к донору ни ДО запуска, ни ПОСЛЕ — */}
                {/* управление эфиром возможно ТОЛЬКО нашими кнопками (OSD: фуллскрин, ⚙️ дорожки/качество/субтитры). */}
                {/* Тап по мембране будит OSD и отправляет в донора команды play (запуск эфира / Anti-Pause). */}
                {/* Донорский таймлайн остаётся видимым, но мёртвым; субтитры донора не перекрываются. */}
                <div
                  className="absolute inset-0 z-30 bg-transparent pointer-events-auto"
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleShieldTap();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                />

                {/* Подсказка до старта эфира: куда нажать, если автоплей заблокирован браузером */}
                {!isLivePlaying && !isLoadingStream && !streamError && (
                  <div className="absolute inset-0 z-[32] flex items-center justify-center pointer-events-none">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-2xl animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />
                      <span>{t('tvTapToStart')}</span>
                    </div>
                  </div>
                )}
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

                  {/* Справа: Кнопка параметров и кнопка во весь экран */}
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {/* Кнопка открытия параметров (звук, качество, субтитры) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsSettingsOpen(prev => !prev);
                        triggerUserActivity();
                      }}
                      className={`w-8 h-8 rounded-lg ${isSettingsOpen ? 'bg-amber-500 text-black border-amber-400 font-bold' : 'bg-white/10 hover:bg-white/20 text-white border-white/10'} active:scale-95 flex items-center justify-center transition-all cursor-pointer ${isControlsVisible ? 'pointer-events-auto' : 'pointer-events-none'} border backdrop-blur-md shrink-0`}
                      title={t('tvSettings')}
                      aria-label={t('tvSettings')}
                    >
                      <span className="text-sm">⚙️</span>
                    </button>

                    {/* Собственная кнопка во весь экран */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFullscreen();
                        triggerUserActivity();
                      }}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center transition-all cursor-pointer border border-white/10 backdrop-blur-md shrink-0"
                      style={{ pointerEvents: isControlsVisible ? 'auto' : 'none' }}
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

              {/* 7. НАШЕ СОБСТВЕННОЕ ВСПЛЫВАЮЩЕЕ МЕНЮ НАСТРОЕК (ПЕРЕВОД, КАЧЕСТВО, СУБТИТРЫ) */}
              {isSettingsOpen && (
                <div 
                  className="absolute inset-x-3 sm:inset-x-auto sm:right-4 bottom-16 z-50 max-w-sm sm:w-80 rounded-2xl bg-black/95 backdrop-blur-2xl border border-white/20 p-4 shadow-2xl text-white select-none animate-fade-in pointer-events-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Заголовок меню и кнопка закрытия */}
                  <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                    <span className="font-extrabold text-xs uppercase tracking-wider text-white/90">
                      {t('tvSettings')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(false)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/10 hover:bg-white/20 transition-all text-xs cursor-pointer"
                      aria-label={t('close')}
                    >
                      ✕
                    </button>
                  </div>

                  {/* Вкладки переключения: Перевод | Качество | Субтитры */}
                  <div className="flex p-1 bg-white/10 rounded-xl mb-3 gap-1 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('sound')}
                      className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                        activeSettingsTab === 'sound'
                          ? 'bg-amber-500 text-black shadow font-black'
                          : 'text-white/70 hover:text-white'
                      }`}
                    >
                      {t('tvAudio')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('quality')}
                      className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                        activeSettingsTab === 'quality'
                          ? 'bg-amber-500 text-black shadow font-black'
                          : 'text-white/70 hover:text-white'
                      }`}
                    >
                      {t('tvQuality')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('cc')}
                      className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                        activeSettingsTab === 'cc'
                          ? 'bg-amber-500 text-black shadow font-black'
                          : 'text-white/70 hover:text-white'
                      }`}
                    >
                      {t('tvSubtitles')}
                    </button>
                  </div>

                  {/* Список доступных опций выбранной вкладки */}
                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 text-xs">
                    {activeSettingsTab === 'sound' && (
                      soundList.length > 0 ? (
                        soundList.map((item) => {
                          const isSelected = item === currentSound;
                          return (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                sendDonorSetting('sound', item);
                                setCurrentSound(item);
                                try {
                                  localStorage.setItem('mediabox_pref_sound', item);
                                } catch (_) {}
                              }}
                              className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between transition-all cursor-pointer border ${
                                isSelected
                                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
                                  : 'bg-white/5 border-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              <span className="truncate pr-2">{item}</span>
                              {isSelected && <span className="text-amber-400 font-bold text-sm shrink-0">✓</span>}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-center py-4 text-white/50 text-[11px]">
                          {t('loading')}
                        </div>
                      )
                    )}

                    {activeSettingsTab === 'quality' && (
                      qualityList.length > 0 ? (
                        qualityList.map((item) => {
                          const isSelected = item === currentQuality;
                          return (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                sendDonorSetting('quality', item);
                                setCurrentQuality(item);
                              }}
                              className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between transition-all cursor-pointer border ${
                                isSelected
                                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
                                  : 'bg-white/5 border-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              <span className="truncate pr-2">{item}</span>
                              {isSelected && <span className="text-amber-400 font-bold text-sm shrink-0">✓</span>}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-center py-4 text-white/50 text-[11px]">
                          {t('loading')}
                        </div>
                      )
                    )}

                    {activeSettingsTab === 'cc' && (
                      ccList.length > 0 ? (
                        ccList.map((item) => {
                          const isSelected = item === currentCc;
                          return (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                sendDonorSetting('cc', item);
                                setCurrentCc(item);
                              }}
                              className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between transition-all cursor-pointer border ${
                                isSelected
                                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
                                  : 'bg-white/5 border-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              <span className="truncate pr-2">{item}</span>
                              {isSelected && <span className="text-amber-400 font-bold text-sm shrink-0">✓</span>}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-center py-4 text-white/50 text-[11px]">
                          {t('tvNoSubtitles')}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
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

          {/* Переход к тайтлу в каталоге: оверлей эфира живёт на уровне App, трансляция продолжается поверх каталога */}
          {!isFullscreen && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/movie/${currentItem.id}?type=${currentItem.type === 'tv' ? 'series' : 'movie'}`);
              }}
              className="w-full mt-2 px-4 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-xs font-bold shadow-xl border border-white/15 flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer pointer-events-auto select-none"
            >
              <span>🎬</span>
              <span>{t('tvOpenInCatalog')}</span>
            </button>
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
                {siblingChannels.map(ch => (
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
