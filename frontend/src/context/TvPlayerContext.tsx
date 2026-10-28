import React, { createContext, useContext, Suspense, lazy, useMemo, useState, useEffect } from 'react';
import type { TvChannel } from '../utils/tvSchedule';
import { useAudioPlayer } from './AudioPlayerContext';

// Плеер ТВ загружается лениво: оверлей монтируется только по факту открытия канала,
// каталог пулов tvSchedule не попадает в бандл главной страницы
const LazyTvPlayer = lazy(() =>
  import('../components/MediaBoxTvPlayer').then(m => ({ default: m.MediaBoxTvPlayer }))
);

interface TvPlayerContextValue {
  activeChannel: TvChannel | null;
  isMinimized: boolean;
  openTv: (channel: TvChannel) => void;
  closeTv: () => void;
  minimizeTv: () => void;
  expandTv: () => void;
  selectChannel: (channel: TvChannel) => void;
}

const TvPlayerContext = createContext<TvPlayerContextValue | undefined>(undefined);

/**
 * Провайдер ТВ-эфира: оверлей плеера живёт на уровне App ВНЕ <Routes>.
 * Поддерживает полноэкранный/оконный режим и свернутый мини-виджет (PiP)
 * для одновременного просмотра эфира и работы с каталогом фильмов.
 */
export const TvPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeChannel, setActiveChannel] = useState<TvChannel | null>(null);
  // Состояние свернутого мини-плеера (Picture-in-Picture внутри приложения)
  const [isMinimized, setIsMinimized] = useState(false);
  const { stop: stopAudio } = useAudioPlayer();

  // При старте воспроизведения радио/музыки автоматически закрываем ТВ-эфир
  useEffect(() => {
    const handleAudioStarted = () => {
      setActiveChannel(null);
      setIsMinimized(false);
    };
    window.addEventListener('mb-audio-started', handleAudioStarted);
    return () => {
      window.removeEventListener('mb-audio-started', handleAudioStarted);
    };
  }, []);

  const value = useMemo<TvPlayerContextValue>(() => ({
    activeChannel,
    isMinimized,
    openTv: (channel) => {
      // Глушим фоновое радио/музыку при старте телевизионной трансляции
      try {
        stopAudio();
      } catch (_) {}
      setActiveChannel(channel);
      setIsMinimized(false);
    },
    closeTv: () => {
      setActiveChannel(null);
      setIsMinimized(false);
    },
    minimizeTv: () => setIsMinimized(true),
    expandTv: () => setIsMinimized(false),
    selectChannel: (channel) => setActiveChannel(channel)
  }), [activeChannel, isMinimized, stopAudio]);

  return (
    <TvPlayerContext.Provider value={value}>
      {children}
      {activeChannel && (
        <Suspense fallback={null}>
          <LazyTvPlayer
            key={activeChannel.id}
            channel={activeChannel}
            isMinimized={isMinimized}
            onMinimize={() => setIsMinimized(true)}
            onExpand={() => setIsMinimized(false)}
            onClose={() => {
              setActiveChannel(null);
              setIsMinimized(false);
            }}
            onSelectChannel={(nextChannel) => setActiveChannel(nextChannel)}
          />
        </Suspense>
      )}
    </TvPlayerContext.Provider>
  );
};

export const useTvPlayer = () => {
  const context = useContext(TvPlayerContext);
  if (!context) {
    throw new Error('useTvPlayer must be used within a TvPlayerProvider');
  }
  return context;
};
