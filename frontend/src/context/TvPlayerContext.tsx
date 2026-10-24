import React, { createContext, useContext, Suspense, lazy, useMemo, useState } from 'react';
import type { TvChannel } from '../utils/tvSchedule';

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

  const value = useMemo<TvPlayerContextValue>(() => ({
    activeChannel,
    isMinimized,
    openTv: (channel) => {
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
  }), [activeChannel, isMinimized]);

  return (
    <TvPlayerContext.Provider value={value}>
      {children}
      {activeChannel && (
        <Suspense fallback={null}>
          <LazyTvPlayer
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
