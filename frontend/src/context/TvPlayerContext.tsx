import React, { createContext, useContext, Suspense, lazy, useMemo, useState } from 'react';
import type { TvChannel } from '../utils/tvSchedule';

// Плеер ТВ загружается лениво: оверлей монтируется только по факту открытия канала,
// каталог пулов tvSchedule не попадает в бандл главной страницы
const LazyTvPlayer = lazy(() =>
  import('../components/MediaBoxTvPlayer').then(m => ({ default: m.MediaBoxTvPlayer }))
);

interface TvPlayerContextValue {
  activeChannel: TvChannel | null;
  openTv: (channel: TvChannel) => void;
  closeTv: () => void;
  selectChannel: (channel: TvChannel) => void;
}

const TvPlayerContext = createContext<TvPlayerContextValue | undefined>(undefined);

/**
 * Провайдер ТВ-эфира: оверлей плеера живёт на уровне App ВНЕ <Routes>,
 * поэтому переход по роуту (/movie/:id — кнопка «Смотреть в каталоге») не размонтирует
 * трансляцию: эфир продолжается поверх любого экрана каталога.
 */
export const TvPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeChannel, setActiveChannel] = useState<TvChannel | null>(null);

  const value = useMemo<TvPlayerContextValue>(() => ({
    activeChannel,
    openTv: (channel) => setActiveChannel(channel),
    closeTv: () => setActiveChannel(null),
    selectChannel: (channel) => setActiveChannel(channel)
  }), [activeChannel]);

  return (
    <TvPlayerContext.Provider value={value}>
      {children}
      {activeChannel && (
        <Suspense fallback={null}>
          <LazyTvPlayer
            channel={activeChannel}
            onClose={() => setActiveChannel(null)}
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
