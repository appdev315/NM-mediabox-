import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { Header } from '../components/Header';
import { BannerAd } from '../components/BannerAd';
import React from 'react';

export function Favorites() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('movie');
  
  const [historyMovies, setHistoryMovies] = useState<any[]>([]);
  const [historySeries, setHistorySeries] = useState<any[]>([]);
  const [historyRadio, setHistoryRadio] = useState<any[]>([]);
  const [historyTv, setHistoryTv] = useState<any[]>([]);

  // Player states
  const { playTrack, currentTrack, isPlaying, stop } = useAudioPlayer();
  const [activeTvChannel, setActiveTvChannel] = useState<any | null>(null);
  const [tvError, setTvError] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);

  const loadHistory = () => {
    try {
      setHistoryMovies(JSON.parse(localStorage.getItem('history_movies') || '[]'));
      setHistorySeries(JSON.parse(localStorage.getItem('history_series') || '[]'));
      setHistoryRadio(JSON.parse(localStorage.getItem('history_radio') || '[]'));
      setHistoryTv(JSON.parse(localStorage.getItem('history_tv') || '[]'));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const removeHistoryItem = (e: React.MouseEvent, id: string | number, type: 'movie' | 'series' | 'radio' | 'tv') => {
    e.stopPropagation();
    try {
      let key = '';
      let list: any[] = [];
      let setList: any = null;

      if (type === 'movie') {
        key = 'history_movies';
        list = historyMovies;
        setList = setHistoryMovies;
      } else if (type === 'series') {
        key = 'history_series';
        list = historySeries;
        setList = setHistorySeries;
      } else if (type === 'radio') {
        key = 'history_radio';
        list = historyRadio;
        setList = setHistoryRadio;
      } else if (type === 'tv') {
        key = 'history_tv';
        list = historyTv;
        setList = setHistoryTv;
      }

      if (key) {
        const newList = list.filter(item => item.id !== id);
        setList(newList);
        localStorage.setItem(key, JSON.stringify(newList));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const clearAllHistory = () => {
    const confirmMsg = t('confirmClearHistory') || 'Вы уверены, что хотите очистить всю историю?';
    if (window.confirm(confirmMsg)) {
      try {
        localStorage.removeItem('history_movies');
        localStorage.removeItem('history_series');
        localStorage.removeItem('history_radio');
        localStorage.removeItem('history_tv');
        setHistoryMovies([]);
        setHistorySeries([]);
        setHistoryRadio([]);
        setHistoryTv([]);
        setActiveTvChannel(null);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handlePlayRadio = (station: any) => {
    setActiveTvChannel(null);
    playTrack({
      id: station.id,
      title: station.name,
      artist: station.group || 'Live Radio',
      url: station.url,
      coverUrl: station.logo,
      type: 'radio'
    });
  };

  const handlePlayTv = (channel: any) => {
    stop();
    setTvError(false);
    setActiveTvChannel(channel);
    setTimeout(() => {
      playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const renderTmdbList = (type: 'movie' | 'series') => {
    const list = type === 'movie' ? historyMovies : historySeries;
    if (list.length === 0) return <div className="text-center mt-12 opacity-50 font-bold" style={{ color: 'var(--text-color)' }}>{t('emptyFavorites') || 'История пуста'}</div>;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4 w-[90%] mx-auto">
        {list.map((item: any, idx) => (
          <React.Fragment key={`${item.id}-${idx}`}>
          <div 
            onClick={() => navigate(`/movie/${item.id}?type=${type}`)}
            className="flex flex-col gap-2 cursor-pointer group relative"
          >
            <div className="relative overflow-hidden rounded-xl shadow-lg transition-transform duration-300 group-hover:shadow-2xl aspect-[2/3]">
              <img 
                src={item.poster} 
                alt={item.title} 
                className="w-full h-full object-cover"
              />
              <button 
                className="absolute top-2 right-2 w-7 h-7 bg-black/60 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md text-white font-bold leading-none flex items-center justify-center text-xs z-20 active:scale-95"
                onClick={(e) => removeHistoryItem(e, item.id, type)}
              >
                ✕
              </button>
            </div>
            <div className="mt-1">
              <h3 className="font-bold text-sm leading-tight line-clamp-1" style={{ color: 'var(--text-color)' }}>{item.title}</h3>
            </div>
          </div>
          {(idx + 1) % 15 === 0 && <BannerAd type={(idx + 1) % 30 === 0 ? "mainbot" : "telegram"} />}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const renderRadioTvList = (type: 'radio' | 'tv') => {
    const list = type === 'radio' ? historyRadio : historyTv;
    if (list.length === 0) return <div className="text-center mt-12 opacity-50 font-bold" style={{ color: 'var(--text-color)' }}>{t('emptyFavorites') || 'История пуста'}</div>;
    
    return (
      <div className="flex flex-col gap-3">
        {activeTvChannel && activeTab === 'tv' && (
          <div ref={playerRef} className="mb-6 rounded-2xl overflow-hidden shadow-xl border md:w-[80%] mx-auto scroll-mt-20" style={{ borderColor: 'var(--hint-color)' }}>
            <div className="bg-black flex justify-between items-center p-3">
              <div className="flex items-center gap-3">
                {activeTvChannel.logo && <img src={activeTvChannel.logo} className="w-8 h-8 rounded-full" />}
                <span className="font-bold text-white truncate">{activeTvChannel.name}</span>
              </div>
              <button onClick={() => setActiveTvChannel(null)} className="text-white opacity-70 hover:opacity-100 font-bold px-2">✕</button>
            </div>
            <div className="relative pt-[56.25%] bg-black flex items-center justify-center">
              {tvError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white px-4 text-center">
                  <span className="text-3xl mb-2">⚠️</span>
                  <p className="font-bold">Stream Unavailable</p>
                </div>
              ) : (
                <video 
                  src={activeTvChannel.url}
                  autoPlay
                  controls 
                  playsInline
                  className="absolute top-0 left-0 w-full h-full object-contain"
                  onError={() => setTvError(true)}
                />
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {list.map((item: any) => {
            const isRadioActive = activeTab === 'radio' && currentTrack?.id === item.id;
            const isTvActive = activeTab === 'tv' && activeTvChannel?.id === item.id;
            const isActive = isRadioActive || isTvActive;

            return (
              <div 
                key={item.id} 
                onClick={() => type === 'radio' ? handlePlayRadio(item) : handlePlayTv(item)}
                className="p-2 rounded-xl flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer border relative hover:scale-[0.99]"
                style={{ 
                  backgroundColor: 'var(--secondary-bg-color, rgba(100, 100, 100, 0.05))',
                  borderColor: isActive ? 'var(--button-color)' : 'var(--hint-color, rgba(150, 150, 150, 0.1))'
                }}
              >
                <button 
                  className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/60 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md text-white font-bold leading-none flex items-center justify-center text-[10px] z-20 active:scale-95"
                  onClick={(e) => removeHistoryItem(e, item.id, type)}
                >
                  ✕
                </button>
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-200 dark:bg-gray-800 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm mt-1">
                  {item.logo ? (
                    <img src={item.logo} alt={item.name} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  ) : (
                    <span className="text-2xl sm:text-3xl">{type === 'radio' ? '📻' : '📺'}</span>
                  )}
                </div>
                <div className="w-full flex-1 min-w-0 mt-1">
                  <div className="font-bold truncate text-[10px] sm:text-xs px-1" style={{ color: 'var(--text-color)' }}>{item.name}</div>
                  {item.group && <div className="text-[10px] opacity-60 truncate" style={{ color: 'var(--text-color)' }}>{item.group}</div>}
                </div>
                <div className="flex w-full justify-end items-center px-1 mt-auto">
                  <span style={{ color: 'var(--text-color)' }} className="text-xs p-1">{isActive ? (type === 'radio' && !isPlaying ? '⏸' : '▶️') : '›'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const hasAnyHistory = historyMovies.length > 0 || historySeries.length > 0 || historyRadio.length > 0 || historyTv.length > 0;

  return (
    <div 
      className="px-3 sm:px-4 pb-24 h-full flex flex-col"
      style={{ paddingTop: 'calc(8rem + env(safe-area-inset-top))' }}
    >
      <Header />
      
      <div className="flex justify-between items-center mb-4 mt-2 px-1">
        <h2 className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--text-color)' }}>
          {t('myFavorites') || 'История'}
        </h2>
        {hasAnyHistory && (
          <button 
            onClick={clearAllHistory}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95 border"
            style={{ 
              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
              color: 'rgb(248, 113, 113)',
              borderColor: 'rgba(239, 68, 68, 0.2)' 
            }}
          >
            {t('clearHistory') || 'Очистить историю'}
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
        {[
          { id: 'movie', label: t('movies') },
          { id: 'series', label: t('series') },
          { id: 'radio', label: t('tab_radio') || 'Радио' },
          { id: 'tv', label: t('tab_tv') || 'ТВ' }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-3 py-2 flex-1 text-sm font-bold rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
            style={{ 
              backgroundColor: activeTab === tab.id ? 'var(--button-color)' : 'transparent',
              color: activeTab === tab.id ? 'var(--button-text-color)' : 'var(--text-color)'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {activeTab === 'movie' && renderTmdbList('movie')}
        {activeTab === 'series' && renderTmdbList('series')}
        {activeTab === 'radio' && renderRadioTvList('radio')}
        {activeTab === 'tv' && renderRadioTvList('tv')}
      </div>
    </div>
  );
}
