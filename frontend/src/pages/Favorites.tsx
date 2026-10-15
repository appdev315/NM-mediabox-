import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { EXPRESS_API_BASE } from '../hooks/useApi';
import { Header } from '../components/Header';
import { WebApp } from '../telegram';
import React from 'react';

import { favoritesManager } from '../utils/favoritesManager';
import { prewarmStream } from '../utils/streamPreloader';
import { AvailBadge } from '../components/AvailBadge';

export function Favorites() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('movie');
  const [mode, setMode] = useState<'favorites' | 'history'>('history');
  
  const [favMovies, setFavMovies] = useState<any[]>([]);
  const [favSeries, setFavSeries] = useState<any[]>([]);
  const [favRadio, setFavRadio] = useState<any[]>([]);

  const [historyMovies, setHistoryMovies] = useState<any[]>([]);
  const [historySeries, setHistorySeries] = useState<any[]>([]);
  const [historyRadio, setHistoryRadio] = useState<any[]>([]);

  // Player states
  const { playTrack, currentTrack, isPlaying, stop } = useAudioPlayer();

  const loadData = () => {
    // Instant 0ms load from LocalStorage
    setFavMovies(favoritesManager.getLocal('movie'));
    setFavSeries(favoritesManager.getLocal('series'));
    setFavRadio(favoritesManager.getLocal('radio'));

    setHistoryMovies(favoritesManager.getHistory('movie'));
    setHistorySeries(favoritesManager.getHistory('series'));
    setHistoryRadio(favoritesManager.getHistory('radio'));
  };

  useEffect(() => {
    loadData();
    // Non-blocking cloud hydration for bookmarks
    favoritesManager.hydrateFromCloud('movie').then(items => setFavMovies(items));
    favoritesManager.hydrateFromCloud('series').then(items => setFavSeries(items));
    favoritesManager.hydrateFromCloud('radio').then(items => setFavRadio(items));
  }, []);

  const removeItem = (e: React.MouseEvent, id: string | number, type: 'movie' | 'series' | 'radio') => {
    e.stopPropagation();
    if (mode === 'favorites') {
      const updated = favoritesManager.remove(type, id);
      if (type === 'movie') setFavMovies(updated);
      else if (type === 'series') setFavSeries(updated);
      else if (type === 'radio') setFavRadio(updated);
    } else {
      const updated = favoritesManager.removeHistory(type, id);
      if (type === 'movie') setHistoryMovies(updated);
      else if (type === 'series') setHistorySeries(updated);
      else if (type === 'radio') setHistoryRadio(updated);
    }
    try {
      WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (_) {}
  };

  const clearCurrentList = () => {
    if (mode === 'favorites') {
      const confirmMsg = t('confirmClearFavorites') || 'Вы уверены, что хотите очистить всё избранное?';
      if (window.confirm(confirmMsg)) {
        try {
          localStorage.removeItem('favorites_movies');
          localStorage.removeItem('favorites_series');
          localStorage.removeItem('favorites_radio');
          setFavMovies([]);
          setFavSeries([]);
          setFavRadio([]);
        } catch (e) {
          console.error(e);
        }
      }
    } else {
      const confirmMsg = t('confirmClearHistory') || 'Вы уверены, что хотите очистить всю историю просмотров?';
      if (window.confirm(confirmMsg)) {
        try {
          stop(); // Stop active radio playback
          localStorage.removeItem('history_movies');
          localStorage.removeItem('history_series');
          localStorage.removeItem('history_radio');
          setHistoryMovies([]);
          setHistorySeries([]);
          setHistoryRadio([]);
        } catch (e) {
          console.error(e);
        }
      }
    }
  };

  const handlePlayRadio = (station: any) => {
    const finalUrl = station.url?.startsWith('http://')
      ? `${EXPRESS_API_BASE}/proxy?url=${encodeURIComponent(station.url)}`
      : station.url;

    playTrack({
      id: station.id,
      title: station.name,
      artist: (station.group && station.group !== 'Radiopotok') ? station.group : 'Live Radio',
      url: finalUrl,
      coverUrl: station.logo,
      type: 'radio'
    });
  };

  const renderTmdbList = (type: 'movie' | 'series') => {
    const list = mode === 'favorites'
      ? (type === 'movie' ? favMovies : favSeries)
      : (type === 'movie' ? historyMovies : historySeries);

    if (list.length === 0) {
      return (
        <div className="text-center mt-12 opacity-50 font-bold" style={{ color: 'var(--text-color)' }}>
          {mode === 'favorites' ? (t('emptyFavorites') || 'В избранном пока ничего нет') : (t('emptyHistory') || 'История просмотров пуста')}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4 w-full">
        {list.map((item: any, idx) => (
          <React.Fragment key={`${item.id}-${idx}`}>
            <div 
              onPointerDown={() => prewarmStream(item.id, item)}
              onClick={() => {
                prewarmStream(item.id, item);
                navigate(`/movie/${item.id}?type=${item.type || type}`);
              }}
              className="flex flex-col gap-2 cursor-pointer group relative"
            >
              <div className="relative overflow-hidden rounded-xl shadow-lg transition-transform duration-300 group-hover:shadow-2xl aspect-[2/3] bg-[var(--hint-color)]">
                <img 
                  src={item.poster} 
                  alt={item.title} 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = 'https://placehold.co/300x450/242f3d/ffffff?text=No+Poster';
                  }}
                />
                <button 
                  className="absolute top-2 right-2 w-7 h-7 bg-black/80 rounded-full hover:scale-110 transition-transform shadow-md text-white font-bold leading-none flex items-center justify-center text-xs z-20 active:scale-95"
                  onClick={(e) => removeItem(e, item.id, type)}
                  title={mode === 'favorites' ? (t('removeFromFavorites') || 'Удалить из избранного') : (t('removeFromHistory') || 'Удалить из истории')}
                >
                  ✕
                </button>
                <AvailBadge type={item.type || type} id={item.id} className="absolute top-2 left-2 z-20" />
              </div>
              <div className="mt-1">
                <h3 className="font-bold text-sm leading-tight line-clamp-1 break-words" style={{ color: 'var(--text-color)' }}>{item.title}</h3>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    );
  };

  const renderRadioList = () => {
    const brokenIds: string[] = (() => {
      try {
        const saved = localStorage.getItem('broken_radio_stations');
        return saved ? JSON.parse(saved) : [];
      } catch (_) { return []; }
    })();
    const rawList = mode === 'favorites' ? favRadio : historyRadio;
    const list = rawList.filter((item: any) => !brokenIds.includes(item.id));

    if (list.length === 0) {
      return (
        <div className="text-center mt-12 opacity-50 font-bold" style={{ color: 'var(--text-color)' }}>
          {mode === 'favorites' ? (t('emptyFavorites') || 'В избранном пока ничего нет') : (t('emptyHistory') || 'История просмотров пуста')}
        </div>
      );
    }
    
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {list.map((item: any) => {
            const isActive = currentTrack?.id === item.id;

            return (
              <div 
                key={item.id} 
                onClick={() => handlePlayRadio(item)}
                className="p-2 rounded-xl flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer border relative hover:scale-[0.99]"
                style={{ 
                  backgroundColor: 'var(--secondary-bg-color, rgba(100, 100, 100, 0.05))',
                  borderColor: isActive ? 'var(--button-color)' : 'var(--hint-color, rgba(150, 150, 150, 0.1))'
                }}
              >
                <button 
                  className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/80 rounded-full hover:scale-110 transition-transform shadow-md text-white font-bold leading-none flex items-center justify-center text-[10px] z-20 active:scale-95"
                  onClick={(e) => removeItem(e, item.id, 'radio')}
                  title={mode === 'favorites' ? (t('removeFromFavorites') || 'Удалить из избранного') : (t('removeFromHistory') || 'Удалить из истории')}
                >
                  ✕
                </button>
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-200 dark:bg-gray-800 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm mt-1">
                  {item.logo ? (
                    <img src={item.logo} alt={item.name} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  ) : (
                    <span className="text-2xl sm:text-3xl">📻</span>
                  )}
                </div>
                <div className="w-full flex-1 min-w-0 mt-1">
                  <div className="font-bold truncate text-[10px] sm:text-xs px-1" style={{ color: 'var(--text-color)' }}>{item.name}</div>
                </div>
                <div className="flex w-full justify-end items-center px-1 mt-auto">
                  <span style={{ color: 'var(--text-color)' }} className="text-xs p-1">{isActive ? (!isPlaying ? '⏸' : '▶️') : '›'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const currentList = mode === 'favorites'
    ? (activeTab === 'movie' ? favMovies : activeTab === 'series' ? favSeries : favRadio)
    : (activeTab === 'movie' ? historyMovies : activeTab === 'series' ? historySeries : historyRadio);

  const hasCurrentItems = currentList.length > 0;

  return (
    <div 
      className="px-3 sm:px-4 pb-24 h-full flex flex-col"
      style={{ paddingTop: 'calc(8rem + env(safe-area-inset-top))' }}
    >
      <Header />
      
      {/* Top Segmented Control: Favorites vs History */}
      <div className="flex bg-black/20 p-1 rounded-xl mb-4 mt-2">
        <button
          onClick={() => {
            setMode('favorites');
            try { WebApp?.HapticFeedback?.selectionChanged(); } catch (_) {}
          }}
          className="flex-1 py-2 px-3 text-xs sm:text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
          style={{
            backgroundColor: mode === 'favorites' ? 'var(--button-color)' : 'transparent',
            color: mode === 'favorites' ? 'var(--button-text-color)' : 'var(--text-color)',
            boxShadow: mode === 'favorites' ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'
          }}
        >
          <span>⭐</span> {t('favorites') || 'Избранное'}
        </button>
        <button
          onClick={() => {
            setMode('history');
            try { WebApp?.HapticFeedback?.selectionChanged(); } catch (_) {}
          }}
          className="flex-1 py-2 px-3 text-xs sm:text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
          style={{
            backgroundColor: mode === 'history' ? 'var(--button-color)' : 'transparent',
            color: mode === 'history' ? 'var(--button-text-color)' : 'var(--text-color)',
            boxShadow: mode === 'history' ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'
          }}
        >
          <span>🕒</span> {t('history') || 'История'}
        </button>
      </div>

      <div className="flex justify-between items-center mb-3 px-1">
        <h2 className="text-lg sm:text-xl font-extrabold tracking-tight" style={{ color: 'var(--text-color)' }}>
          {mode === 'favorites' ? (t('myFavorites') || 'Моё избранное') : (t('history') || 'История просмотров')}
        </h2>
        {hasCurrentItems && (
          <button 
            onClick={clearCurrentList}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95 border"
            style={{ 
              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
              color: 'rgb(248, 113, 113)',
              borderColor: 'rgba(239, 68, 68, 0.2)' 
            }}
          >
            {mode === 'favorites' ? (t('clearFavorites') || 'Очистить избранное') : (t('clearHistory') || 'Очистить историю')}
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
        {[
          { id: 'movie', label: t('movies') },
          { id: 'series', label: t('series') },
          { id: 'radio', label: t('tab_radio') || 'Радио' }
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
        {activeTab === 'radio' && renderRadioList()}
      </div>
    </div>
  );
}
