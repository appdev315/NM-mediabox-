import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';
import { Player, findLowestQuality } from './Player';
import { CF_API_BASE, getTmdbImageUrl } from '../hooks/useApi';
import { clientCache } from '../utils/clientCache';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { useLanguage } from '../context/LanguageContext';
import { 
  type TvChannel, 
  type ChannelScheduleState, 
  getChannelScheduleState, 
  getChannelUpcomingSchedule,
  getItemTitle,
  getChannelName,
  TV_CHANNELS
} from '../utils/tvSchedule';

// Фолбэк AbortSignal для старых WebView / iOS Safari
function timeoutSignal(ms: number): AbortSignal {
  const anyAbortSignal = AbortSignal as any;
  if (typeof anyAbortSignal?.timeout === 'function') {
    return anyAbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

interface MediaBoxTvPlayerProps {
  channel: TvChannel;
  isMinimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  onClose: () => void;
  onSelectChannel: (channel: TvChannel) => void;
}

export function MediaBoxTvPlayer({ 
  channel, 
  isMinimized = false,
  onMinimize,
  onExpand,
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

  // Вычисление моментального состояния эфира канала
  const [scheduleState, setScheduleState] = useState<ChannelScheduleState>(() => 
    getChannelScheduleState(channel)
  );
  // Актуальная ссылка на состояние эфира для безопасного доступа внутри таймеров и обработчиков событий
  const scheduleStateRef = useRef(scheduleState);
  useEffect(() => {
    scheduleStateRef.current = scheduleState;
  }, [scheduleState]);

  // Немедленный сброс и синхронизация состояния эфира при смене канала
  useEffect(() => {
    setScheduleState(getChannelScheduleState(channel));
    setStreamError(false);
    setIsLoadingStream(true);
    setIframeUrl(null);
  }, [channel.id]);

  // Ссылка на контейнер плеера для перехвата событий колесика мыши
  const videoBoxRef = useRef<HTMLDivElement>(null);

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

  // Реальная длительность потока в секундах из манифеста донора (для предотвращения SEEK_PAST_EOF)
  const actualDurationRef = useRef<number | null>(null);
  // Флаг установки минимального начального качества при старте стрима
  const hasSetInitialQualityRef = useRef(false);
  // Счётчик попыток перехода на следующий тайтл при 404 (до 2 подряд)
  const fallbackAttemptsRef = useRef(0);
  // Метка времени последней синхронизации эфира (защита от частых сиков)
  const lastLiveSyncSeekRef = useRef<number>(0);

  // Блокировка отката дорожки донором Liftw: после ручного выбора пользователем
  // игнорируем любые попытки донора сбросить дорожку на дефолтный русский дубляж
  const userSoundLockUntilRef = useRef<number>(0);
  const userSelectedSoundRef = useRef<string | null>(null);

  // Отправка команды изменения настроек в iframe донора Liftw через postMessage API
  const sendDonorSetting = useCallback((key: 'sound' | 'quality' | 'cc', value: string) => {
    try {
      const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
      if (ifr && ifr.contentWindow) {
        ifr.contentWindow.postMessage({ req: 'setting set', key, value }, '*');
      }
    } catch (_) {}
  }, []);

  // Надежный выбор аудиодорожки с защитой от .once(AUDIO_TRACK_SWITCHED) сброса донора
  const selectSoundTrack = useCallback((item: string) => {
    userSoundLockUntilRef.current = Date.now() + 4000;
    userSelectedSoundRef.current = item;
    setCurrentSound(item);
    try {
      localStorage.setItem('mediabox_pref_sound', item);
    } catch (_) {}

    sendDonorSetting('sound', item);
    // Double-tap handshake: повторная отправка для фиксации после отработки внутреннего сброса донора
    setTimeout(() => {
      sendDonorSetting('sound', item);
    }, 350);
    setTimeout(() => {
      sendDonorSetting('sound', item);
    }, 850);
  }, [sendDonorSetting]);

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
    hasSetInitialQualityRef.current = false;
    actualDurationRef.current = null;
    lastLiveSyncSeekRef.current = 0;
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

  // Тап по активному шилду: пробуждаем OSD-элементы интерфейса
  const handleShieldTap = useCallback(() => {
    triggerUserActivity();
  }, [triggerUserActivity]);

  // Реакция OSD на фактический старт эфира: один раз показываем панель
  useEffect(() => {
    if (isLivePlaying) {
      triggerUserActivity();
    }
  }, [isLivePlaying, triggerUserActivity]);

  // 0. ПРЕДОТВРАЩЕНИЕ ДУБЛИРОВАНИЯ ПЛАШКИ ГРОМКОСТИ:
  // Блокируем захват колесика мыши и стрелок громкости донорским iframe (player-venom),
  // чтобы не вызывать всплывающий слайдер громкости плеера поверх нативной системной громкости.
  useEffect(() => {
    const el = videoBoxRef.current;
    if (!el) return;

    const blockWheel = (e: WheelEvent) => {
      // Разрешаем свободную прокрутку колесом мыши внутри меню настроек (дорожки, качество, субтитры)
      if ((e.target as HTMLElement)?.closest?.('[data-settings-menu]')) {
        return;
      }
      // Изолируем колесо мыши от донорского iframe с отменой стандартного действия
      e.preventDefault();
      e.stopPropagation();
    };

    const blockKeyArrows = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Перехватываем стрелки громкости в capture-фазе, защищая от наслоения плашек
        e.stopPropagation();
      }
    };

    el.addEventListener('wheel', blockWheel, { passive: false });
    window.addEventListener('keydown', blockKeyArrows, { capture: true });

    return () => {
      el.removeEventListener('wheel', blockWheel);
      window.removeEventListener('keydown', blockKeyArrows, { capture: true });
    };
  }, []);

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
            // Если начальное качество еще не выбрано — автоматически выставляем минимальное для стабильного старта на слабом интернете
            if (!hasSetInitialQualityRef.current && data.ls.length > 0) {
              const minQuality = findLowestQuality(data.ls);
              if (minQuality) {
                hasSetInitialQualityRef.current = true;
                sendDonorSetting('quality', minQuality);
                setCurrentQuality(minQuality);
              }
            }
          } else if (data.key === 'cc' && Array.isArray(data.ls)) {
            setCcList(data.ls);
          }
        }

        // Обработка активных выбранных значений из донора Liftw ('setting')
        if (data.event === 'setting') {
          if (data.key === 'sound' && typeof data.value === 'string') {
            // Если пользователь недавно выбрал дорожку вручную, блокируем откат на дефолтный русский дубляж
            if (Date.now() < userSoundLockUntilRef.current) {
              if (userSelectedSoundRef.current && data.value !== userSelectedSoundRef.current) {
                // Донор пытается откатить дорожку: повторно отправляем команду выбора пользователя
                sendDonorSetting('sound', userSelectedSoundRef.current);
              }
              return;
            }
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

        // Синхронизация прямого эфира (Live TV Sync Watchdog): если донор стартовал сначала (0:00) вместо таймкода эфира
        if (
          data.event === 'timeupdate' || 
          data.event === 'viewProgress' || 
          data.type === 'timeupdate' || 
          data.event === 'time' || 
          data.type === 'time'
        ) {
          const rawPos = data.time ?? data.currentTime ?? data.position;
          if (typeof rawPos === 'number') {
            const currentLiveSec = Math.floor(scheduleStateRef.current.elapsedSec);
            // Если донор воспроизводит первые секунды (< 15с), а эфир ушёл вперёд (> 45с) — принудительно синхронизируем
            if (rawPos < 15 && currentLiveSec > 45 && Date.now() - lastLiveSyncSeekRef.current > 3000) {
              lastLiveSyncSeekRef.current = Date.now();
              const ifr = document.querySelector<HTMLIFrameElement>('#video-iframe');
              if (ifr && ifr.contentWindow) {
                ifr.contentWindow.postMessage({ event: 'seek', time: currentLiveSec }, '*');
                ifr.contentWindow.postMessage({ api: 'seek', set: currentLiveSec }, '*');
                ifr.contentWindow.postMessage({ command: 'seek', time: currentLiveSec }, '*');
                ifr.contentWindow.postMessage({ event: 'play' }, '*');
              }
            }
          }
        }
        // Обработка сообщений плеера Liftw о фактическом воспроизведении
      } catch (_) {}
    };

    window.addEventListener('message', handleTvMessage);
    return () => {
      window.removeEventListener('message', handleTvMessage);
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

  const loadStreamRef = useRef<((bypassCache?: boolean) => Promise<void>) | null>(null);

  // Подгрузка видеопотока из Liftw с поддержкой персистентного кэша и аварийного обновления
  useEffect(() => {
    let isCancelled = false;
    const { currentItem } = scheduleState;
    const cacheKey = `liftw_stream_v3_${currentItem.id}_${currentItem.type}`;
    const minRealisticSec = currentItem.type === 'tv' ? 300 : 1500;

    const loadStream = async (bypassCache = false) => {
      setIsLoadingStream(true);
      setStreamError(false);

      if (bypassCache) {
        // Принудительный сброс локального кеша при падении или повторе
        clientCache.remove(cacheKey);
        actualDurationRef.current = null;
      } else {
        // 1. Проверяем локальный кэш (синхронный localStorage и асинхронный IndexedDB)
        const cached = clientCache.get<any>(cacheKey) || (await clientCache.getAsync<any>(cacheKey));
        if (cached && cached.iframe && !isCancelled) {
          if (cached.durationSec && cached.durationSec >= minRealisticSec) {
            actualDurationRef.current = cached.durationSec;
          }
          setIframeUrl(cached.iframe);
          setIsLoadingStream(false);
          return;
        }
      }

      try {
        const query = new URLSearchParams({
          tmdb: String(currentItem.id),
          type: currentItem.type === 'tv' ? 'tv' : 'movie',
          title: currentItem.title,
          original_title: currentItem.origin_title || '',
          year: currentItem.year
        });

        if (bypassCache) {
          query.set('bypass_cache', 'true');
        }

        // Запрос с умным повтором (2 попытки) и расширенным таймаутом (14 сек) для слабого интернета
        const res = await fetchWithRetry(`${CF_API_BASE}/liftw?${query.toString()}`, {
          maxRetries: 2,
          baseDelayMs: 300,
          maxDelayMs: 1500,
          signal: timeoutSignal(14000)
        });

        if (!res.ok) throw new Error(`Поток недоступен (${res.status})`);
        const data = await res.json() as any;

        if (data && data.iframe && !isCancelled) {
          fallbackAttemptsRef.current = 0;
          // Сохраняем в кэш на 90 дней (7776000 сек) для фильмов и сериалов
          const ttlSeconds = 7776000;
          clientCache.set(cacheKey, data, ttlSeconds);
          if (data.durationSec && data.durationSec >= minRealisticSec) {
            actualDurationRef.current = data.durationSec;
          }
          setIframeUrl(data.iframe);
          setIsLoadingStream(false);
        } else if (!isCancelled) {
          throw new Error('Пустой iframe');
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('[MediaBoxTv] Ошибка загрузки потока:', err);
          // При ошибке очищаем поврежденный кэш, чтобы при следующем запросе источник обновился
          clientCache.remove(cacheKey);

          // Бесшовный авто-фолбэк: если фильм отсутствует на доноре Liftw (404),
          // автоматически подхватываем следующий тайтл сетки вещания (до 2 попыток)
          if (fallbackAttemptsRef.current < 2 && scheduleState.nextItem && scheduleState.nextItem.id !== currentItem.id) {
            fallbackAttemptsRef.current += 1;
            setScheduleState(prev => ({
              ...prev,
              currentItem: prev.nextItem,
              initialTimecode: 0,
              elapsedSec: 0,
              remainingSec: prev.nextItem.durationSec || 7200,
              durationSec: prev.nextItem.durationSec || 7200,
              progressPercent: 0
            }));
            return;
          }

          setStreamError(true);
          setIsLoadingStream(false);
        }
      }
    };

    loadStreamRef.current = loadStream;
    loadStream(false);

    return () => {
      isCancelled = true;
    };
  }, [scheduleState.currentItem.id, scheduleState.currentItem.episode, scheduleState.slotIndex, channel.id]);

  const { currentItem, initialTimecode, nextItem, formattedNextTime } = scheduleState;
  const isSeries = currentItem.type === 'tv';

  // Вычисляем безопасный таймкод с учетом реальной длительности потока из манифеста донора.
  // Защита от циклического перезапуска: если эфир вышел за фактическую длительность, не делаем modulo (который сбрасывал на 2:38),
  // а удерживаем воспроизведение за 10 секунд до финала в ожидании естественного перехода сетки на следующий тайтл
  const catalogDuration = currentItem.durationSec || 7200;
  const minRealisticSec = isSeries ? 300 : 1500;
  const validActual = (actualDurationRef.current && actualDurationRef.current >= minRealisticSec)
    ? actualDurationRef.current
    : null;
  const maxDuration = validActual || catalogDuration;

  let safeTimecode: number;
  if (initialTimecode >= maxDuration) {
    safeTimecode = Math.max(0, maxDuration - 10);
  } else {
    safeTimecode = Math.max(0, Math.floor(initialTimecode));
  }
  const finalTimecode = Math.min(safeTimecode, Math.max(0, maxDuration - 10));

  return (
    <div 
      className={
        isMinimized
          ? "fixed bottom-20 right-3 sm:right-6 z-50 w-72 sm:w-80 rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-black flex flex-col select-none pointer-events-auto transition-all animate-fade-in group cursor-pointer"
          : isFullscreen
            ? "fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden"
            : "fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-6 select-none overflow-hidden"
      }
      onClick={isMinimized ? onExpand : isFullscreen ? triggerUserActivity : onClose}
      onMouseMove={triggerUserActivity}
      onTouchStart={triggerUserActivity}
    >
      {/* Обертка для оконного режима: объединяет плеер и правый сайдбар на десктопе */}
      <div 
        className={
          isMinimized
            ? "relative w-full h-full flex flex-col"
            : isFullscreen
              ? "w-full h-full flex flex-col"
              : "relative w-full max-w-6xl xl:max-w-7xl flex flex-col lg:flex-row items-center lg:items-stretch justify-center gap-4 max-h-[92vh]"
        }
      >
        {/* Колонка плеера: включает плашку звука сверху и плашку «ДАЛЕЕ» снизу в вертикальном/оконном режиме */}
        <div className={isMinimized ? "w-full h-full flex flex-col" : isFullscreen ? "w-full h-full flex flex-col" : "flex-1 w-full flex flex-col items-center justify-center max-w-full"}>
          
          {/* Вспомогательный Smart Audio Badge над плеером в вертикальном/оконном режиме со стрелкой на шестеренку */}
          {showAudioBadge && !isLoadingStream && !streamError && !isFullscreen && !isMinimized && (
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
            ref={videoBoxRef}
            className={
              isMinimized
                ? "relative w-full aspect-video rounded-2xl overflow-hidden bg-black flex flex-col"
                : isFullscreen
                  ? "relative w-full h-full flex flex-col bg-black overflow-hidden"
                  : "relative w-full aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/15 bg-black flex flex-col"
            }
            onClick={(e) => {
              if (isMinimized && onExpand) {
                e.stopPropagation();
                onExpand();
                return;
              }
              e.stopPropagation();
              triggerUserActivity();
            }}
            onDoubleClick={(e) => {
              if (!isMinimized) {
                e.stopPropagation();
                toggleFullscreen();
              }
            }}
          >
            {/* 1.1 Компактная плашка управления мини-плеером (PiP) */}
            {isMinimized && (
              <div 
                className="absolute top-0 left-0 right-0 z-40 px-3 py-2 flex items-center justify-between bg-gradient-to-b from-black/90 via-black/50 to-transparent pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div 
                  className="flex items-center gap-1.5 min-w-0 cursor-pointer"
                  onClick={onExpand}
                >
                  <span className="font-bold text-white text-xs truncate max-w-[130px]">
                    {getChannelName(channel, language)}
                  </span>
                  <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {onExpand && (
                    <button
                      type="button"
                      onClick={onExpand}
                      className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/15 hover:bg-white/25 active:scale-95 text-white transition-all cursor-pointer border border-white/15 text-xs font-bold"
                      title={t('expand') || 'Развернуть'}
                      aria-label={t('expand') || 'Развернуть'}
                    >
                      ⤢
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-600/80 hover:bg-red-600 active:scale-95 text-white transition-all cursor-pointer border border-white/15 text-xs font-bold"
                    title={t('close') || 'Закрыть'}
                    aria-label={t('close') || 'Закрыть'}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* 2. Верхний скрывающийся OSD-бар: Кнопка Назад, Свернуть, Название канала, Шестеренка */}
            {!isMinimized && (
              <div 
                className={`absolute top-0 left-0 right-0 z-40 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 pointer-events-none ${
                  isControlsVisible ? 'opacity-100' : 'opacity-0'
                }`}
                style={isFullscreen ? { paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' } : undefined}
              >
                {/* Слева: кнопка закрытия ✕ и кнопка сворачивания в мини-плеер ⤓ */}
                <div className={`flex items-center gap-1.5 ${isControlsVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all cursor-pointer backdrop-blur-md border border-white/10"
                    aria-label={t('tvBackToChannels')}
                    title={t('close') || 'Закрыть'}
                  >
                    ✕
                  </button>
                  {onMinimize && !isFullscreen && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMinimize();
                      }}
                      className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all cursor-pointer backdrop-blur-md border border-white/10"
                      aria-label={t('minimize') || 'Свернуть'}
                      title={t('minimize') || 'Свернуть'}
                    >
                      <span className="text-sm font-bold">⤓</span>
                    </button>
                  )}
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

              {/* Справа: Наша фирменная кнопка настроек (звук, качество, субтитры) */}
              <div className={`flex items-center ${isControlsVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSettingsOpen(prev => !prev);
                    triggerUserActivity();
                  }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer backdrop-blur-md border ${
                    isSettingsOpen 
                      ? 'bg-amber-500 text-black border-amber-400 font-bold shadow-lg scale-105' 
                      : 'bg-white/10 hover:bg-white/20 active:scale-95 text-white border-white/10'
                  }`}
                  title={t('tvSettings')}
                  aria-label={t('tvSettings')}
                >
                  <span className="text-base">⚙️</span>
                </button>
              </div>
            </div>
          )}

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
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => loadStreamRef.current?.(true)}
                      className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs shadow-lg active:scale-95 transition-all cursor-pointer"
                    >
                      {t('retry') || 'Повторить'}
                    </button>
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
                    initialTimecode={finalTimecode}
                    targetEpisode={isSeries && currentItem.season ? { season: currentItem.season, episode: currentItem.episode || '1' } : undefined}
                    isTv={true}
                    onReady={handlePlayerReady}
                  />
                )}

                {/* 5. ЭКРАН ЗАЩИТЫ ВИДЕО (БЛОКИРОВКА ПАУЗЫ ПОСЛЕ СТАРТА): */}
                {/* До старта потока (isLivePlaying=false) экран прозрачен: один нативный клик пользователя */}
                {/* запускает Play донора. После старта (isLivePlaying=true) экран наглухо блокируется от тапов-пауз. */}
                <div
                  className={`absolute inset-0 z-30 bg-transparent ${
                    isLivePlaying ? 'pointer-events-auto' : 'pointer-events-none'
                  }`}
                  style={{ touchAction: 'none' }}
                  onWheel={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleShieldTap();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                />

                {/* 6. ГЛУХОЙ БАРЬЕР НИЖНЕЙ ЗОНЫ (ТАЙМЛАЙН И НАВЕРХУ ДОНОРСКИЕ МЕНЮ): */}
                {/* 100% блокирует клики по таймлайну и нативной шестеренке донора. Таймлайн виден, но не интерактивен. */}
                <div 
                  className="absolute bottom-0 left-0 right-0 h-11 z-30 bg-transparent pointer-events-auto"
                  style={{ touchAction: 'none' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerUserActivity();
                  }}
                />

                {/* 7. ЕДИНСТВЕННЫЙ АКТИВНЫЙ ЭЛЕМЕНТ ВНИЗУ: КНОПКА ВО ВЕСЬ ЭКРАН */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                    triggerUserActivity();
                  }}
                  className={`absolute bottom-2 right-2.5 z-40 w-8 h-8 rounded-lg bg-black/75 hover:bg-black/90 active:scale-95 text-white flex items-center justify-center transition-all cursor-pointer border border-white/20 backdrop-blur-md shadow-xl ${
                    isControlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                  }`}
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

              {/* 8. НАШЕ СОБСТВЕННОЕ ВСПЛЫВАЮЩЕЕ МЕНЮ НАСТРОЕК (ПЕРЕВОД, КАЧЕСТВО, СУБТИТРЫ) */}
              {!isMinimized && isSettingsOpen && (
                <div 
                  data-settings-menu="true"
                  className="absolute inset-x-3 sm:inset-x-auto sm:right-4 top-16 z-50 max-w-sm sm:w-80 rounded-2xl bg-black/95 backdrop-blur-2xl border border-white/20 p-4 shadow-2xl text-white select-none animate-fade-in pointer-events-auto"
                  onClick={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
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

                  {/* Список доступных опций выбранной вкладки: плавная прокрутка всех 18+ дорожек */}
                  <div 
                    className="max-h-60 sm:max-h-72 overflow-y-auto space-y-1.5 pr-1.5 text-xs overscroll-contain touch-pan-y scrollbar-thin"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
                    {activeSettingsTab === 'sound' && (
                      soundList.length > 0 ? (
                        soundList.map((item) => {
                          const isSelected = item === currentSound;
                          return (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                selectSoundTrack(item);
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

          {/* Плашка «ДАЛЕЕ» вынесена под плеер в вертикальном/оконном положении; в горизонтальном/полноэкранном режиме и PiP отсутствует */}
          {!isFullscreen && !isMinimized && (
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

          {/* Переход к тайтлу в каталоге: оверлей эфира сворачивается в компактный PiP, трансляция продолжается в углу поверх каталога */}
          {!isFullscreen && !isMinimized && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onMinimize) {
                  onMinimize();
                }
                navigate(`/movie/${currentItem.id}?type=${currentItem.type === 'tv' ? 'series' : 'movie'}`);
              }}
              className="w-full mt-2 px-4 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-xs font-bold shadow-xl border border-white/15 flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer pointer-events-auto select-none"
            >
              <span>🎬</span>
              <span>{t('tvOpenInCatalog')}</span>
            </button>
          )}
        </div>

        {/* 7. Внешний сайдбар программы передач: строго при !isFullscreen, !isMinimized и только на десктопе (hidden lg:flex) */}
        {!isFullscreen && !isMinimized && (
          <aside 
            className="hidden lg:flex w-80 xl:w-96 rounded-2xl bg-[#141b22]/90 backdrop-blur-xl border border-white/10 p-4 flex-col gap-3 shadow-2xl overflow-hidden shrink-0 self-stretch"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-bold text-white text-sm">{getChannelName(channel, language)}</h3>
                <span className="text-[11px] text-white/50">{t('tvProgram')}</span>
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
                      {sched.isTomorrow && (
                        <span className="text-[9px] font-bold text-amber-400/90 bg-amber-400/10 border border-amber-400/20 px-1 py-0.2 rounded">
                          +1д
                        </span>
                      )}
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
