import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMusicApi, type MusicTrack, resolveFullAudioUrl } from '../hooks/useMusicApi';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';
import { favoritesManager } from '../utils/favoritesManager';
import { audioOfflineManager } from '../utils/audioOfflineManager';
import { EqualizerModal } from './EqualizerModal';

export function AppleMusic() {
  const { t } = useLanguage();
  const { loading, searchMusic } = useMusicApi();
  const { playTrack, currentTrack, isPlaying, isShuffle, toggleShuffle, setQueue } = useAudioPlayer();

  const [activeTab, setActiveTab] = useState<'search' | 'favorites'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [cachedUrls, setCachedUrls] = useState<Set<string>>(new Set());
  const [cacheStats, setCacheStats] = useState<{ count: number; sizeBytes: number }>({ count: 0, sizeBytes: 0 });
  const [isEqOpen, setIsEqOpen] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const searchAbortRef = useRef<number>(0);

  const [favTracks, setFavTracks] = useState<MusicTrack[]>(() => {
    try {
      const saved = localStorage.getItem('favorites_music');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });



  // Sync favorites set
  const favIds = useMemo(() => new Set(favTracks.map(t => t.id)), [favTracks]);

  // Refresh audio offline cache stats
  const refreshCacheStats = useCallback(async () => {
    const stats = await audioOfflineManager.getAudioCacheStats();
    setCacheStats(stats);
    const urls = new Set<string>();
    for (const t of favTracks) {
      if (t.audioUrl && (await audioOfflineManager.isAudioCached(t.audioUrl))) {
        urls.add(t.audioUrl);
      }
    }
    setCachedUrls(urls);
  }, [favTracks]);

  useEffect(() => {
    refreshCacheStats();
  }, [refreshCacheStats]);

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
        audioOfflineManager.removeTrackAudio(track.audioUrl).then(refreshCacheStats);
      } else {
        updated = [track, ...prev];
        audioOfflineManager.saveTrackAudio(track.id, track.audioUrl).then(refreshCacheStats);
      }
      try {
        localStorage.setItem('favorites_music', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  const [isExporting, setIsExporting] = useState(false);
  const [exportingTrackId, setExportingTrackId] = useState<string | null>(null);

  const handleExportAll = async () => {
    if (isExporting || favTracks.length === 0) return;
    setIsExporting(true);
    try {
      try {
        WebApp?.HapticFeedback?.impactOccurred('medium');
      } catch (_) {}
      await audioOfflineManager.exportTracks(favTracks);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportTrack = async (track: MusicTrack, e: React.MouseEvent) => {
    e.stopPropagation();
    if (exportingTrackId === track.id) return;
    setExportingTrackId(track.id);
    try {
      try {
        WebApp?.HapticFeedback?.selectionChanged();
      } catch (_) {}
      await audioOfflineManager.exportTrack(track);
    } finally {
      setExportingTrackId(null);
    }
  };

  const handleClearCache = async () => {
    try {
      WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (_) {}
    await audioOfflineManager.clearAudioCache();
    await refreshCacheStats();
  };

  const playAllFavorites = (shuffle = false) => {
    if (favTracks.length === 0) return;
    try {
      WebApp?.HapticFeedback?.impactOccurred('medium');
    } catch (_) {}

    const playlist = favTracks.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      url: t.audioUrl,
      coverUrl: t.artworkUrl,
      type: 'music' as const
    }));

    if (shuffle) {
      if (!isShuffle) toggleShuffle();
      const randIdx = Math.floor(Math.random() * playlist.length);
      playTrack(playlist[randIdx], playlist);
    } else {
      if (isShuffle) toggleShuffle();
      playTrack(playlist[0], playlist);
    }
  };

  const moveTrack = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= favTracks.length) return;

    try {
      WebApp?.HapticFeedback?.selectionChanged();
    } catch (_) {}

    const updated = [...favTracks];
    const item = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = item;

    setFavTracks(updated);
    try {
      localStorage.setItem('favorites_music', JSON.stringify(updated));
    } catch (_) {}

    const updatedQueue = updated.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      url: t.audioUrl,
      coverUrl: t.artworkUrl,
      type: 'music' as const
    }));
    setQueue(updatedQueue);
  };

  const performSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const reqId = ++searchAbortRef.current;
    const results = await searchMusic(q, 60);
    if (reqId === searchAbortRef.current) {
      setSearchResults(results);
    }
  }, [searchMusic]);

  // Debounce search by 600ms
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      performSearch(q);
    }, 600);
    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);



  // Play track handler with adaptive stream resolution
  const handleSelectTrack = async (track: MusicTrack) => {
    try {
      WebApp?.HapticFeedback?.impactOccurred('medium');
    } catch (_) {}

    let fullAudioUrl = track.audioUrl;
    if (!track.isResolved && (!track.audioUrl || track.audioUrl.includes('preview') || track.audioUrl.includes('mzstatic') || track.audioUrl.includes('itunes') || track.audioUrl.includes('dzcdn') || track.id.startsWith('yt_') || track.audioUrl.includes('invidious'))) {
      try {
        fullAudioUrl = await resolveFullAudioUrl(track.artist, track.title, track.audioUrl, track.id);
      } catch (_) {}
    }

    const localBlobUrl = await audioOfflineManager.getTrackAudioUrl(fullAudioUrl);
    const effectiveAudioUrl = localBlobUrl || fullAudioUrl;

    const currentList = activeTab === 'search' && searchResults.length > 0 
      ? searchResults 
      : favTracks;

    const playlist = currentList.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      url: t.id === track.id ? fullAudioUrl : t.audioUrl,
      coverUrl: t.artworkUrl,
      type: 'music' as const
    }));

    playTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      url: effectiveAudioUrl,
      coverUrl: track.artworkUrl,
      type: 'music'
    }, playlist);

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



  const isCurrentPlayingThis = (id: string) => currentTrack?.id === id && isPlaying;

  return (
    <div className="flex flex-col min-h-full pb-32 text-white">
      {/* MediaBox Music Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#FA2D48] flex items-center justify-center shadow-lg shadow-[#FA2D48]/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <div>
            <span className="text-xl font-extrabold tracking-tight">MediaBox Music</span>
          </div>
        </div>
      </div>

      {/* Segmented Navigation: 2 Clean Tabs (Apple HIG) */}
      <div className="flex p-1 bg-white/10 rounded-xl mb-4 backdrop-blur-md">
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'search' ? 'bg-[#FA2D48] text-white shadow-md' : 'text-white/70'
          }`}
        >
          🔍 {t('music_search') || 'Поиск'}
        </button>
        <button
          onClick={() => setActiveTab('favorites')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'favorites' ? 'bg-[#FA2D48] text-white shadow-md' : 'text-white/70'
          }`}
        >
          ❤️ {t('music_favorites') || 'Избранное'} ({favTracks.length})
        </button>
      </div>

      {/* Search Bar */}
      {activeTab === 'search' && (
        <div className="relative mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
                performSearch(searchQuery);
              }
            }}
            placeholder={t('music_search_placeholder') || 'Исполнитель или трек'}
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

      {/* Favorites Cache Header Bar */}
      {activeTab === 'favorites' && favTracks.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 mb-3 bg-white/5 rounded-2xl border border-white/5">
          <div className="text-xs font-semibold text-white/70 truncate mr-2">
            {cacheStats.count > 0 ? `${t('music_cache')}: ${cacheStats.count} • ${audioOfflineManager.formatBytes(cacheStats.sizeBytes)}` : t('music_cache_empty')}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {cacheStats.count > 0 && (
              <button
                onClick={handleExportAll}
                disabled={isExporting}
                className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold text-white border border-white/10 transition-colors active:scale-95 flex items-center gap-1"
                title={t('music_to_files') || 'В Файлы'}
              >
                <span>{isExporting ? '⏳' : '📥'}</span>
                <span>{isExporting ? t('music_exporting') : t('music_to_files')}</span>
              </button>
            )}
            {cacheStats.count > 0 && (
              <button
                onClick={handleClearCache}
                className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-red-500/20 text-xs font-bold text-white/90 hover:text-red-400 border border-white/10 transition-colors active:scale-95"
              >
                {t('music_clear_cache')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Favorites Playlist Action Bar */}
      {activeTab === 'favorites' && favTracks.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => playAllFavorites(false)}
            className="flex-1 py-2 px-3 rounded-2xl bg-[#FA2D48] hover:bg-[#e0263e] text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-[#FA2D48]/30 active:scale-95 transition-all"
          >
            <span>▶️</span>
            <span>{t('music_play_all')}</span>
          </button>

          <button
            onClick={() => playAllFavorites(true)}
            className="flex-1 py-2 px-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center justify-center gap-1.5 border border-white/10 active:scale-95 transition-all"
          >
            <span>🔀</span>
            <span>{t('music_shuffle')}</span>
          </button>

          <button
            onClick={() => setIsReorderMode(prev => !prev)}
            className={`py-2 px-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1 border active:scale-95 transition-all ${
              isReorderMode
                ? 'bg-white text-black border-white shadow-md'
                : 'bg-white/10 hover:bg-white/15 text-white/90 border-white/10'
            }`}
          >
            <span>{isReorderMode ? '✓' : '⇅'}</span>
            <span>{isReorderMode ? t('music_done') : t('music_reorder')}</span>
          </button>
        </div>
      )}

      {/* Track List */}
      <div className="flex flex-col gap-1.5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 border-4 border-[#FA2D48] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-semibold text-white/50">{t('searching') || 'Поиск...'}</span>
          </div>
        ) : (
          (() => {
            const list = activeTab === 'search' ? searchResults : favTracks;

            if (list.length === 0) {
              if (activeTab === 'search') {
                return (
                  <div className="text-center py-16 text-white/40 font-medium text-sm flex flex-col items-center gap-2">
                    <span className="text-3xl">🎵</span>
                    <span>
                      {searchQuery.trim().length >= 2
                        ? (t('music_no_results') || 'Ничего не найдено')
                        : (t('music_search_prompt') || 'Поиск музыки')}
                    </span>
                  </div>
                );
              }
              return (
                <div className="text-center py-16 text-white/40 font-bold text-sm">
                  {t('music_no_favorites') || 'В избранном пока нет треков'}
                </div>
              );
            }

            return list.map((track, idx) => {
              const isThisPlaying = isCurrentPlayingThis(track.id);
              const isTrackSelected = currentTrack?.id === track.id;
              const isFav = favIds.has(track.id);
              const isOffline = cachedUrls.has(track.audioUrl);

              return (
                <div
                  key={track.id}
                  onClick={() => {
                    if (isReorderMode && activeTab === 'favorites') return;
                    handleSelectTrack(track);
                  }}
                  className={`flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer transition-all active:scale-[0.99] border ${
                    isTrackSelected 
                      ? 'bg-white/15 border-[#FA2D48]/50 shadow-md' 
                      : 'bg-white/5 hover:bg-white/10 border-white/5'
                  }`}
                >
                  {/* Reorder index in favorites */}
                  {activeTab === 'favorites' && isReorderMode && (
                    <span className="w-5 text-center text-xs font-black text-[#FA2D48]">
                      {idx + 1}
                    </span>
                  )}

                  {/* Artwork with squircle */}
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-white/10 shadow-sm">
                    <img 
                      src={track.artworkUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop&q=80'} 
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
                    <div className="flex items-center gap-1.5">
                      <h3 className={`text-sm font-bold truncate ${isTrackSelected ? 'text-[#FA2D48]' : 'text-white'}`}>
                        {track.title}
                      </h3>
                      {isOffline && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-extrabold flex-shrink-0">
                          {t('music_offline')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/60 truncate mt-0.5">
                      {track.artist}
                    </p>
                  </div>

                  {/* Reorder Up/Down Controls or Export/Heart */}
                  {activeTab === 'favorites' && isReorderMode ? (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => moveTrack(idx, -1)}
                        disabled={idx === 0}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 flex items-center justify-center text-white text-xs font-black active:scale-90 transition-all"
                        title={t('music_move_up')}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveTrack(idx, 1)}
                        disabled={idx === favTracks.length - 1}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 flex items-center justify-center text-white text-xs font-black active:scale-90 transition-all"
                        title={t('music_move_down')}
                      >
                        ▼
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Export Button (in Favorites tab) */}
                      {activeTab === 'favorites' && (
                        <button
                          onClick={(e) => handleExportTrack(track, e)}
                          disabled={exportingTrackId === track.id}
                          className="p-2 text-white/50 hover:text-white transition-all active:scale-90 flex-shrink-0"
                          title={t('music_to_files') || 'В Файлы'}
                        >
                          {exportingTrackId === track.id ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          )}
                        </button>
                      )}

                      {/* Favorite Heart Button */}
                      <button
                        onClick={(e) => toggleFav(track, e)}
                        className="p-2 text-base transition-transform active:scale-125"
                        style={{ color: isFav ? '#FA2D48' : 'rgba(255,255,255,0.3)' }}
                      >
                        {isFav ? '❤️' : '🤍'}
                      </button>
                    </>
                  )}
                </div>
              );
            });
          })()
        )}
      </div>



      {/* Studio Equalizer Sheet */}
      <EqualizerModal isOpen={isEqOpen} onClose={() => setIsEqOpen(false)} />
    </div>
  );
}
