import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { Header } from '../components/Header';
import { BannerAd } from '../components/BannerAd';
import React from 'react';

export function Favorites() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();


  const [activeTab, setActiveTab] = useState('movie');
  
  const [tmdbFavs, setTmdbFavs] = useState<any[]>([]);
  const [radioTvFavs, setRadioTvFavs] = useState<any[]>([]);
  const [privateFavs, setPrivateFavs] = useState<any[]>([]);
  
  // Player states
  const { playTrack, currentTrack, isPlaying, stop } = useAudioPlayer();
  const [activeTvChannel, setActiveTvChannel] = useState<any | null>(null);
  const [tvError, setTvError] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTmdbFavs(JSON.parse(localStorage.getItem('favorites') || '[]'));
    setRadioTvFavs(JSON.parse(localStorage.getItem('radio_tv_favs') || '[]'));
    setPrivateFavs(JSON.parse(localStorage.getItem('private_favs') || '[]'));
  }, []);

  const removeTmdbFav = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newFavs = tmdbFavs.filter(f => f.id !== id);
    setTmdbFavs(newFavs);
    localStorage.setItem('favorites', JSON.stringify(newFavs));
  };

  const removeRadioTvFav = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newFavs = radioTvFavs.filter(f => f.id !== id);
    setRadioTvFavs(newFavs);
    localStorage.setItem('radio_tv_favs', JSON.stringify(newFavs));
  };

  const removePrivateFav = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newFavs = privateFavs.filter(f => f.id !== id);
    setPrivateFavs(newFavs);
    localStorage.setItem('private_favs', JSON.stringify(newFavs));
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

  const renderTmdbList = (type: 'movie' | 'tv') => {
    const list = tmdbFavs.filter(f => f.type === type);
    if (list.length === 0) return <div className="text-center mt-12 opacity-50" style={{ color: 'var(--text-color)' }}>{t('emptyList')}</div>;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
        {list.map((item: any, idx) => (
          <React.Fragment key={`${item.id}-${idx}`}>
          <div 
            onClick={() => navigate(`/movie/${item.id}?type=${item.type}`)}
            className="flex flex-col gap-2 cursor-pointer group"
          >
            <div className="relative overflow-hidden rounded-xl shadow-lg transition-transform duration-300 group-hover:shadow-2xl">
              <img 
                src={item.poster} 
                alt={item.title} 
                className="w-full aspect-[2/3] object-cover"
              />
              <button 
                className="absolute top-2 right-2 p-2 bg-black/50 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md"
                onClick={(e) => removeTmdbFav(e, item.id)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            </div>
            <div className="mt-1">
              <h3 className="font-bold text-sm leading-tight line-clamp-1" style={{ color: 'var(--text-color)' }}>{item.title}</h3>
            </div>
          </div>
          {(idx + 1) % 15 === 0 && <BannerAd />}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const renderRadioTvList = (type: 'radio' | 'tv') => {
    const list = radioTvFavs.filter(f => f.type === type);
    if (list.length === 0) return <div className="text-center mt-12 opacity-50" style={{ color: 'var(--text-color)' }}>{t('emptyList')}</div>;
    
    return (
      <div className="flex flex-col gap-3">
        {activeTvChannel && activeTab === 'TV' && (
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

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {list.map((item: any) => {
            const isRadioActive = activeTab === 'Radio' && currentTrack?.id === item.id;
            const isTvActive = activeTab === 'TV' && activeTvChannel?.id === item.id;
            const isActive = isRadioActive || isTvActive;

            return (
              <div 
                key={item.id} 
                onClick={() => type === 'radio' ? handlePlayRadio(item) : handlePlayTv(item)}
                className={`p-3 rounded-xl flex flex-col items-center text-center gap-2 transition-all cursor-pointer border ${isActive ? 'ring-2 ring-blue-500 scale-[0.98]' : 'hover:scale-[0.99]'}`}
                style={{ 
                  backgroundColor: 'var(--secondary-bg-color, rgba(100, 100, 100, 0.05))',
                  borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.1))'
                }}
              >
                <div className="w-16 h-16 rounded-2xl bg-gray-200 dark:bg-gray-800 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm mt-1">
                  {item.logo ? (
                    <img src={item.logo} alt={item.name} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  ) : (
                    <span className="text-3xl">{type === 'radio' ? '📻' : '📺'}</span>
                  )}
                </div>
                <div className="w-full flex-1 min-w-0 mt-1">
                  <div className="font-bold truncate text-sm" style={{ color: 'var(--text-color)' }}>{item.name}</div>
                  {item.group && <div className="text-[10px] opacity-60 truncate" style={{ color: 'var(--text-color)' }}>{item.group}</div>}
                </div>
                <div className="flex w-full justify-between items-center px-1 mt-auto">
                <button 
                  className="text-xl hover:scale-110 transition-transform drop-shadow-md" 
                  style={{ color: '#fbbf24' }}
                  onClick={(e) => removeRadioTvFav(e, item.id)}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-md">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                  <span style={{ color: 'var(--text-color)' }} className="text-sm p-1">{isActive ? (type === 'radio' && !isPlaying ? '⏸' : '▶️') : '›'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPrivateList = () => {
    if (privateFavs.length === 0) return <div className="text-center mt-12 opacity-50" style={{ color: 'var(--text-color)' }}>{t('emptyList')}</div>;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {privateFavs.map((v: any, idx) => (
          <div 
            key={`${v.id}-${idx}`} 
            className="cursor-pointer active:scale-95 transition-transform group"
            onClick={() => navigate(`/adult/${v.id}`)}
          >
            <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-2 relative shadow-lg group-hover:shadow-xl transition-shadow">
              <img src={v.poster} className="w-full h-full object-cover" alt="" />
              <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                {v.duration}
              </div>
              <button 
                className="absolute top-2 right-2 p-2 bg-black/50 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md"
                onClick={(e) => removePrivateFav(e, v.id)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            </div>
            <p className="text-sm font-bold line-clamp-2 leading-snug" style={{ color: 'var(--text-color)' }}>{v.title}</p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 pt-6 pb-24 h-full flex flex-col">
      <Header />
      
      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
        {[
          { id: 'movie', label: t('movies') },
          { id: 'series', label: t('series') },
          { id: 'radio-tv', label: t('radio_and_tv') },
          ...(language === 'ru-RU' ? [{ id: 'downloads', label: t('downloadsTab') }] : []),
          ...(localStorage.getItem('showPrivate') !== 'false' ? [{ id: 'private', label: 'Private 🍓' }] : [])
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
        {activeTab === 'series' && renderTmdbList('tv')}
        {activeTab === 'radio-tv' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--text-color)' }}>{t('tab_radio')}</h2>
              {renderRadioTvList('radio')}
            </div>
            <div>
              <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--text-color)' }}>{t('tab_tv')}</h2>
              {renderRadioTvList('tv')}
            </div>
          </div>
        )}
        {activeTab === 'downloads' && (
          <div className="text-center mt-12 opacity-50 flex flex-col items-center gap-2">
            <span className="text-4xl">📥</span>
            <p style={{ color: 'var(--text-color)' }}>{t('emptyFavorites')}</p>
          </div>
        )}
        {activeTab === 'private' && renderPrivateList()}
      </div>
    </div>
  );
}
