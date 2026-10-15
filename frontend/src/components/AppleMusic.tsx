import React, { useState, useEffect, useMemo } from 'react';
import { useMusicApi, type MusicTrack } from '../hooks/useMusicApi';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { WebApp } from '../telegram';
import { favoritesManager } from '../utils/favoritesManager';

const REGIONS = [
  { code: 'ru', flag: '🇷🇺', name: 'Россия' },
  { code: 'us', flag: '🇺🇸', name: 'США' },
  { code: 'gb', flag: '🇬🇧', name: 'Великобритания' },
  { code: 'de', flag: '🇩🇪', name: 'Германия' },
  { code: 'fr', flag: '🇫🇷', name: 'Франция' },
  { code: 'es', flag: '🇪🇸', name: 'Испания' },
  { code: 'kz', flag: '🇰🇿', name: 'Казахстан' },
  { code: 'by', flag: '🇧🇾', name: 'Беларусь' },
];

export function AppleMusic() {
  const { loading, fetchTopCharts, searchMusic } = useMusicApi();
  const { playTrack, currentTrack, isPlaying, togglePlayPause, audioRef } = useAudioPlayer();

  const [region, setRegion] = useState(() => {
    const saved = localStorage.getItem('app_music_region');
    if (saved) return saved;
    const tgLang = WebApp.initDataUnsafe?.user?.language_code;
    if (tgLang === 'ru') return 'ru';
    if (tgLang === 'de') return 'de';
    if (tgLang === 'fr') return 'fr';
    if (tgLang === 'es') return 'es';
    return 'us';
  });

  const [activeTab, setActiveTab] = useState<'charts' | 'search' | 'favorites'>('charts');
  const [searchQuery, setSearchQuery] = useState('');
  const [chartTracks, setChartTracks] = useState<MusicTrack[]>([]);
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [favTracks, setFavTracks] = useState<MusicTrack[]>(() => {
    try {
      const saved = localStorage.getItem('favorites_music');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  // Full-screen player sheet state
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30); // iTunes previews are 30s
  const [volume, setVolume] = useState(1);

  // Sync favorites
  const favIds = useMemo(() => new Set(favTracks.map(t => t.id)), [favTracks]);

  const toggleFav = (track: MusicTrack, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (_) {}

    setFavTracks(prev => {
      const exists = prev.some(t => t.id === track.id);
      let updated: MusicTrack[];
      if (exists) {
        updated = prev.filter(t => t.id !== track.id);
      } else {
        updated = [track, ...prev];
      }
      try {
        localStorage.setItem('favorites_music', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  // Load Charts on region change
  useEffect(() => {
    localStorage.setItem('app_music_region', region);
    let isCancelled = false;
    fetchTopCharts(region, 50).then(tracks => {
      if (!isCancelled) {
        setChartTracks(tracks);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [region, fetchTopCharts]);

  // Search debounce
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      searchMusic(q, 35).then(results => {
        setSearchResults(results);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMusic]);

  // Audio time listener for progress bar
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [audioRef]);

  // Play track handler
  const handleSelectTrack = (track: MusicTrack) => {
    try {
      WebApp?.HapticFeedback?.impactOccurred('medium');
    } catch (_) {}

    playTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      url: track.audioUrl,
      coverUrl: track.artworkUrl,
      type: 'radio' // AudioPlayer recognizes stream
    });

    // Save to history
    try {
      favoritesManager.addHistory('radio', {
        id: track.id,
        name: track.title,
        url: track.audioUrl,
        logo: track.artworkUrl,
        group: track.artist,
        type: 'radio'
      });
    } catch (_) {}
  };

  const handleNextTrack = () => {
    const currentList = activeTab === 'search' && searchResults.length > 0 
      ? searchResults 
      : activeTab === 'favorites' 
      ? favTracks 
      : chartTracks;
    
    if (currentList.length === 0) return;
    const currentIndex = currentList.findIndex(t => t.id === currentTrack?.id);
    const nextIndex = (currentIndex + 1) % currentList.length;
    handleSelectTrack(currentList[nextIndex]);
  };

  const handlePrevTrack = () => {
    const currentList = activeTab === 'search' && searchResults.length > 0 
      ? searchResults 
      : activeTab === 'favorites' 
      ? favTracks 
      : chartTracks;
    
    if (currentList.length === 0) return;
    const currentIndex = currentList.findIndex(t => t.id === currentTrack?.id);
    const prevIndex = (currentIndex - 1 + currentList.length) % currentList.length;
    handleSelectTrack(currentList[prevIndex]);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef?.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (audioRef?.current) {
      audioRef.current.volume = newVol;
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const featuredTrack = chartTracks[0];
  const isCurrentPlayingThis = (id: string) => currentTrack?.id === id && isPlaying;

  return (
    <div className="flex flex-col min-h-full pb-32 text-white">
      {/* Apple Music Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#FA2D48] flex items-center justify-center shadow-lg shadow-[#FA2D48]/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <div>
            <span className="text-xl font-extrabold tracking-tight">Apple Music</span>
          </div>
        </div>

        {/* Region selector */}
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="bg-white/10 text-xs font-bold px-3 py-1.5 rounded-full border border-white/10 focus:outline-none"
        >
          {REGIONS.map(r => (
            <option key={r.code} value={r.code} className="bg-[#1c1c1e] text-white">
              {r.flag} {r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Segmented Pills Navigation */}
      <div className="flex p-1 bg-white/10 rounded-xl mb-4 backdrop-blur-md">
        <button
          onClick={() => setActiveTab('charts')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'charts' ? 'bg-[#FA2D48] text-white shadow-md' : 'text-white/70'
          }`}
        >
          🔥 Чарты
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'search' ? 'bg-[#FA2D48] text-white shadow-md' : 'text-white/70'
          }`}
        >
          🔍 Поиск
        </button>
        <button
          onClick={() => setActiveTab('favorites')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'favorites' ? 'bg-[#FA2D48] text-white shadow-md' : 'text-white/70'
          }`}
        >
          ❤️ Любимые ({favTracks.length})
        </button>
      </div>

      {/* Search Input Bar */}
      {activeTab === 'search' && (
        <div className="relative mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Треки, исполнители или альбомы..."
            className="w-full pl-10 pr-10 py-3 bg-white/10 border border-white/10 rounded-2xl text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FA2D48]"
          />
          <div className="absolute left-3.5 top-3.5 text-white/50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-white/50 hover:text-white text-xs font-bold w-6 h-6 rounded-full bg-white/10 flex items-center justify-center"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Featured #1 Track Hero Banner (Only on Charts tab) */}
      {activeTab === 'charts' && featuredTrack && !loading && (
        <div 
          onClick={() => handleSelectTrack(featuredTrack)}
          className="relative rounded-3xl overflow-hidden mb-6 p-5 cursor-pointer transition-transform active:scale-[0.98] shadow-2xl border border-white/10 flex flex-col justify-end min-h-[170px]"
          style={{
            backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 100%), url(${featuredTrack.artworkUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        >
          <div className="absolute top-4 left-4 bg-[#FA2D48] px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider">
            № 1 В ЧАРТЕ
          </div>
          <div className="mt-8 flex justify-between items-end">
            <div className="max-w-[75%]">
              <h2 className="text-xl font-extrabold line-clamp-1 drop-shadow-md">{featuredTrack.title}</h2>
              <p className="text-sm font-semibold text-white/80 line-clamp-1">{featuredTrack.artist}</p>
            </div>
            <button 
              className="w-12 h-12 rounded-full bg-[#FA2D48] flex items-center justify-center shadow-lg shadow-[#FA2D48]/50 active:scale-90 transition-transform"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectTrack(featuredTrack);
              }}
            >
              {isCurrentPlayingThis(featuredTrack.id) ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21" /></svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Track List */}
      <div className="flex flex-col gap-1.5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 border-4 border-[#FA2D48] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-semibold text-white/50">Загрузка треков...</span>
          </div>
        ) : (
          (() => {
            const list = activeTab === 'search' 
              ? searchResults 
              : activeTab === 'favorites' 
              ? favTracks 
              : chartTracks;

            if (list.length === 0) {
              return (
                <div className="text-center py-16 text-white/40 font-bold text-sm">
                  {activeTab === 'favorites' 
                    ? 'Вы пока не сохранили ни одного трека ❤️' 
                    : activeTab === 'search' && searchQuery 
                    ? 'Ничего не найдено' 
                    : 'Треки не найдены'}
                </div>
              );
            }

            return list.map((track, idx) => {
              const isThisPlaying = isCurrentPlayingThis(track.id);
              const isTrackSelected = currentTrack?.id === track.id;
              const isFav = favIds.has(track.id);

              return (
                <div
                  key={track.id}
                  onClick={() => handleSelectTrack(track)}
                  className={`flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer transition-all active:scale-[0.99] border ${
                    isTrackSelected 
                      ? 'bg-white/15 border-[#FA2D48]/50 shadow-md' 
                      : 'bg-white/5 hover:bg-white/10 border-white/5'
                  }`}
                >
                  {/* Rank number for Charts */}
                  {activeTab === 'charts' && (
                    <span className="w-6 text-center text-xs font-black text-white/40">
                      {idx + 1}
                    </span>
                  )}

                  {/* Artwork with squircle */}
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-white/10 shadow-sm">
                    <img 
                      src={track.artworkUrl} 
                      alt={track.title} 
                      className="w-full h-full object-cover" 
                      loading="lazy"
                    />
                    {isThisPlaying && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="flex items-end gap-0.5 h-4">
                          <span className="w-1 bg-[#FA2D48] animate-[bounce_1s_infinite] h-full rounded-full" />
                          <span className="w-1 bg-[#FA2D48] animate-[bounce_0.8s_infinite] h-2/3 rounded-full" />
                          <span className="w-1 bg-[#FA2D48] animate-[bounce_1.2s_infinite] h-4/5 rounded-full" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm font-bold truncate ${isTrackSelected ? 'text-[#FA2D48]' : 'text-white'}`}>
                      {track.title}
                    </h3>
                    <p className="text-xs text-white/60 truncate mt-0.5">
                      {track.artist}
                    </p>
                  </div>

                  {/* Favorite Heart Button */}
                  <button
                    onClick={(e) => toggleFav(track, e)}
                    className="p-2 text-base transition-transform active:scale-125"
                    style={{ color: isFav ? '#FA2D48' : 'rgba(255,255,255,0.3)' }}
                  >
                    {isFav ? '❤️' : '🤍'}
                  </button>
                </div>
              );
            });
          })()
        )}
      </div>

      {/* Apple Music Floating Mini-Player Bar */}
      {currentTrack && !isExpanded && (
        <div
          onClick={() => setIsExpanded(true)}
          className="fixed left-3 right-3 z-40 p-2.5 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-2xl border cursor-pointer active:scale-[0.99] transition-transform"
          style={{
            bottom: '76px',
            backgroundColor: 'rgba(24, 24, 28, 0.92)',
            borderColor: 'rgba(255, 255, 255, 0.12)'
          }}
        >
          {/* Cover Art */}
          <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 shadow-md">
            <img 
              src={currentTrack.coverUrl} 
              alt={currentTrack.title} 
              className="w-full h-full object-cover" 
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm truncate text-white">
              {currentTrack.title}
            </div>
            <div className="text-xs text-white/60 truncate">
              {currentTrack.artist}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={togglePlayPause}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-90 transition-transform"
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
              )}
            </button>
            <button
              onClick={handleNextTrack}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 active:scale-90 transition-transform"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5"/></svg>
            </button>
          </div>

          {/* Progress hairline */}
          <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-[#FA2D48] transition-all duration-300" 
              style={{ width: `${(currentTime / (duration || 30)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Full-Screen Apple Music Now Playing Sheet */}
      {isExpanded && currentTrack && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col justify-between p-6 animate-in slide-in-from-bottom duration-300 backdrop-blur-3xl overflow-y-auto"
          style={{
            backgroundColor: 'rgba(12, 12, 16, 0.98)',
            paddingTop: 'calc(1.5rem + env(safe-area-inset-top))',
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))'
          }}
        >
          {/* Top Bar: Dismiss Chevron & Title */}
          <div className="flex items-center justify-between w-full">
            <button
              onClick={() => setIsExpanded(false)}
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/80 hover:text-white"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <span className="text-xs font-black tracking-widest uppercase text-white/50">Apple Music</span>
            <div className="w-10" />
          </div>

          {/* Big Squircle Artwork with ambient shadow */}
          <div className="flex flex-col items-center justify-center my-auto py-4">
            <div 
              className={`w-64 h-64 sm:w-80 sm:h-80 rounded-3xl overflow-hidden shadow-2xl border border-white/10 transition-transform duration-500 ${
                isPlaying ? 'scale-100 shadow-[0_20px_50px_rgba(250,45,72,0.35)]' : 'scale-90 opacity-80'
              }`}
            >
              <img 
                src={currentTrack.coverUrl} 
                alt={currentTrack.title} 
                className="w-full h-full object-cover" 
              />
            </div>

            {/* Quality pill */}
            <div className="mt-4 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-[10px] font-black uppercase tracking-wider text-white/70">
              Apple Lossless • 256 kbps AAC
            </div>
          </div>

          {/* Track Details & Heart */}
          <div className="w-full max-w-md mx-auto mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1 min-w-0 pr-4">
                <h1 className="text-2xl font-black truncate text-white">{currentTrack.title}</h1>
                <p className="text-base font-semibold text-white/70 truncate">{currentTrack.artist}</p>
              </div>
              <button
                onClick={() => {
                  const asMusic: MusicTrack = {
                    id: currentTrack.id,
                    title: currentTrack.title,
                    artist: currentTrack.artist,
                    artworkUrl: currentTrack.coverUrl || '',
                    audioUrl: currentTrack.url
                  };
                  toggleFav(asMusic);
                }}
                className="text-2xl transition-transform active:scale-125"
              >
                {favIds.has(currentTrack.id) ? '❤️' : '🤍'}
              </button>
            </div>

            {/* Scrubber slider */}
            <div className="w-full flex flex-col gap-1 mb-6">
              <input
                type="range"
                min="0"
                max={duration || 30}
                step="0.1"
                value={currentTime}
                onChange={handleSeek}
                className="w-full accent-[#FA2D48] h-1.5 bg-white/20 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[11px] font-semibold text-white/50">
                <span>{formatTime(currentTime)}</span>
                <span>-{formatTime(Math.max(0, (duration || 30) - currentTime))}</span>
              </div>
            </div>

            {/* Media Controls */}
            <div className="flex items-center justify-center gap-8 mb-6">
              <button 
                onClick={handlePrevTrack}
                className="p-3 text-white/80 hover:text-white active:scale-90 transition-transform"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5"/></svg>
              </button>

              <button 
                onClick={togglePlayPause}
                className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-xl active:scale-90 transition-transform"
              >
                {isPlaying ? (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
                )}
              </button>

              <button 
                onClick={handleNextTrack}
                className="p-3 text-white/80 hover:text-white active:scale-90 transition-transform"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5"/></svg>
              </button>
            </div>

            {/* Volume Slider */}
            <div className="flex items-center gap-3 px-4">
              <span className="text-white/40 text-xs">🔈</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={handleVolumeChange}
                className="flex-1 accent-white h-1 bg-white/20 rounded-lg cursor-pointer"
              />
              <span className="text-white/40 text-xs">🔊</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
