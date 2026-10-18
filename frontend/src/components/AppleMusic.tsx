import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMusicApi, isMusicDataSaverEnabled, setMusicDataSaver, getNetworkSpeed, type MusicTrack, type MusicAlbum, PLACEHOLDER_ARTWORK } from '../hooks/useMusicApi';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';
import { favoritesManager } from '../utils/favoritesManager';
import { audioOfflineManager } from '../utils/audioOfflineManager';

const formatTrackDuration = (secs?: number | string): string => {
  if (!secs) return '';
  let n = typeof secs === 'string' ? parseFloat(secs) : secs;
  if (isNaN(n) || n <= 0) return '';
  if (n > 10000) n = Math.round(n / 1000);
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export function AppleMusic() {
  const { t, language } = useLanguage();
  const { loading, searchMusic, searchAlbums, fetchAlbumTracks } = useMusicApi();
  const { playTrack, currentTrack, isPlaying, isBuffering, isShuffle, toggleShuffle, setQueue } = useAudioPlayer();

  const [activeTab, setActiveTab] = useState<'search' | 'favorites'>('search');
  const [dataSaver, setDataSaver] = useState(() => isMusicDataSaverEnabled());

  // Traffic saver: pick the low-bitrate stream for every *new* playback from this list
  const pickUrl = useCallback((track: MusicTrack): string =>
    (dataSaver && track.audioUrlLow) ? track.audioUrlLow : track.audioUrl
  , [dataSaver]);

  const toggleDataSaver = () => {
    const next = !dataSaver;
    setDataSaver(next);
    setMusicDataSaver(next);
    try {
      WebApp?.HapticFeedback?.notificationOccurred(next ? 'success' : 'warning');
    } catch (_) {}
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreSearch, setHasMoreSearch] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [albums, setAlbums] = useState<MusicAlbum[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<MusicAlbum | null>(null);
  const [albumTracks, setAlbumTracks] = useState<MusicTrack[]>([]);
  const [loadingAlbum, setLoadingAlbum] = useState(false);
  const [cachedUrls, setCachedUrls] = useState<Set<string>>(new Set());
  const [cacheStats, setCacheStats] = useState<{ count: number; sizeBytes: number }>({ count: 0, sizeBytes: 0 });
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [unavailableToast, setUnavailableToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<number>(0);
  const albumRequestRef = useRef<number>(0);
  const scrollPosRef = useRef<number>(0);

  // Listen for full track resolution failure events
  useEffect(() => {
    const handleUnavailable = (e: any) => {
      try {
        WebApp?.HapticFeedback?.notificationOccurred('warning');
      } catch (_) {}
      const trackName = e.detail?.title ? `«${e.detail.title}»` : '';
      setUnavailableToast(`${t('music_full_unavailable') || 'Полная версия трека недоступна'} ${trackName}`.trim());
      // One shared timer: a newer toast must not be killed by an older event's timeout
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setUnavailableToast(null), 3500);
    };

    window.addEventListener('music-track-unavailable', handleUnavailable);
    return () => {
      window.removeEventListener('music-track-unavailable', handleUnavailable);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [t]);

  const [favTracks, setFavTracks] = useState<MusicTrack[]>(() => {
    try {
      const saved = localStorage.getItem('favorites_music');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });



  // Sync favorites set с поддержкой как сырого id, так и чистого без saavn_
  const favIds = useMemo(() => {
    const set = new Set<string>();
    favTracks.forEach(t => {
      const raw = String(t.id || '');
      const clean = raw.replace(/^saavn_/, '');
      if (raw) set.add(raw);
      if (clean) set.add(clean);
    });
    return set;
  }, [favTracks]);

  // Неблокирующая синхронизация с облачным бэкапом Cloudflare D1 при запуске
  useEffect(() => {
    favoritesManager.hydrateFromCloud('music').then(items => {
      if (Array.isArray(items) && items.length > 0) {
        setFavTracks(items);
      }
    });
  }, []);

  // Refresh audio offline cache stats
  const refreshCacheStats = useCallback(async () => {
    const stats = await audioOfflineManager.getAudioCacheStats();
    setCacheStats(stats);
    const urls = new Set<string>();
    for (const t of favTracks) {
      if ((t.audioUrl || t.id) && (await audioOfflineManager.isAudioCached(t.audioUrl, t.id))) {
        if (t.audioUrl) urls.add(t.audioUrl);
        if (t.id) urls.add(t.id);
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

    const cleanTrackId = String(track.id || '').replace(/^saavn_/, '');
    const exists = favTracks.some(t => String(t.id || '').replace(/^saavn_/, '') === cleanTrackId);

    if (exists) {
      // Локальное удаление + асинхронный синк с Cloudflare D1
      const updated = favoritesManager.remove('music', track.id);
      setFavTracks(updated);
      audioOfflineManager.removeTrackAudio(track.audioUrl, track.id).then(refreshCacheStats);
    } else {
      // Локальное сохранение + асинхронный синк с Cloudflare D1
      const updated = favoritesManager.add('music', track);
      setFavTracks(updated);

      // Кэшируем трек в оффлайн-хранилище устройства СТРОГО при добавлении в избранное («❤️»)
      (async () => {
        const isSlowNet = getNetworkSpeed().isSlow || dataSaver;
        let streamUrl = isSlowNet ? (track.audioUrlLow || track.audioUrl) : track.audioUrl;
        if (!streamUrl || streamUrl.includes('preview') || streamUrl.includes('dzcdn')) {
          const { resolveFullAudioUrl } = await import('../hooks/useMusicApi');
          streamUrl = await resolveFullAudioUrl(track.artist, track.title, track.audioUrl, track.id);
        }
        if (streamUrl) {
          await audioOfflineManager.saveTrackAudio(track.id, streamUrl, isSlowNet ? 'low' : 'high');
          refreshCacheStats();
        }
      })().catch(() => {});
    }
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
      url: pickUrl(t),
      coverUrl: t.artworkUrl,
      type: 'music' as const
    }));

    if (shuffle) {
      if (!isShuffle) toggleShuffle();
      const randIdx = Math.floor(Math.random() * playlist.length);
      const chosen = playlist[randIdx];
      playTrack(chosen, playlist);
    } else {
      if (isShuffle) toggleShuffle();
      const first = playlist[0];
      playTrack(first, playlist);
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
      setAlbums([]);
      setSelectedAlbum(null);
      setAlbumTracks([]);
      setSearchPage(1);
      setHasMoreSearch(false);
      return;
    }
    const reqId = ++searchAbortRef.current;
    setSelectedAlbum(null);
    setAlbumTracks([]);
    setSearchPage(1);

    // Выдаем первые 20 треков порционно для мгновенной отрисовки без зависания ленты
    const [tracks, foundAlbums] = await Promise.all([
      searchMusic(q, 1, 20),
      searchAlbums(q, 10)
    ]);

    if (reqId === searchAbortRef.current) {
      setSearchResults(tracks);
      setAlbums(foundAlbums);
      // Если на 1-й странице есть треки, разрешаем подгрузку следующих страниц (не блокируем запросы из-за дедупликации)
      setHasMoreSearch(tracks.length >= 10);
    }
  }, [searchMusic, searchAlbums]);

  const loadMoreTracks = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || q.length < 2 || loadingMore || !hasMoreSearch || selectedAlbum || activeTab !== 'search') return;

    setLoadingMore(true);
    const nextPage = searchPage + 1;
    try {
      // Подгрузка следующих треков порционно без размонтирования DOM-дерева
      const moreTracks = await searchMusic(q, nextPage, 20);
      if (moreTracks && moreTracks.length > 0) {
        setSearchResults(prev => {
          const existingIds = new Set(prev.map(t => t.id));
          const uniqueNew = moreTracks.filter(t => !existingIds.has(t.id));
          return [...prev, ...uniqueNew];
        });
        setSearchPage(nextPage);
        // Продолжаем пагинацию до 15 страниц, пока возвращаются треки
        setHasMoreSearch(moreTracks.length > 0 && nextPage < 15);
      } else {
        setHasMoreSearch(false);
      }
    } catch (_) {
      setHasMoreSearch(false);
    } finally {
      setLoadingMore(false);
    }
  }, [searchQuery, loadingMore, hasMoreSearch, selectedAlbum, activeTab, searchPage, searchMusic]);

  // Callback ref: подключает IntersectionObserver мгновенно при монтировании элемента в DOM
  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node || !hasMoreSearch || activeTab !== 'search' || selectedAlbum) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMoreTracks();
      }
    }, { rootMargin: '450px' });

    observer.observe(node);
    observerRef.current = observer;
  }, [hasMoreSearch, activeTab, selectedAlbum, loadMoreTracks]);

  // Очистка observer при размонтировании компонента
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  const handleSelectAlbum = async (album: MusicAlbum) => {
    try {
      WebApp?.HapticFeedback?.selectionChanged();
    } catch (_) {}
    scrollPosRef.current = typeof window !== 'undefined' ? window.scrollY : 0;
    const reqId = ++albumRequestRef.current;
    setSelectedAlbum(album);
    setLoadingAlbum(true);
    const tracks = await fetchAlbumTracks(album.id);
    if (reqId !== albumRequestRef.current) return;
    setAlbumTracks(tracks);
    setLoadingAlbum(false);
  };

  const handleBackToSearch = () => {
    try {
      WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (_) {}
    albumRequestRef.current++;
    setSelectedAlbum(null);
    setAlbumTracks([]);
    setLoadingAlbum(false);
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        window.scrollTo({ top: scrollPosRef.current, behavior: 'instant' });
      }, 20);
    }
  };

  // Debounce search by 600ms
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setAlbums([]);
      setSelectedAlbum(null);
      setAlbumTracks([]);
      return;
    }
    const timer = setTimeout(() => {
      performSearch(q);
    }, 600);
    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);

  // Play track handler: starts synchronously in the click task so iOS Safari
  // keeps the user-activation gesture. AudioPlayerContext resolves the full
  // stream + offline blob in the background and upgrades src when needed.
  const handleSelectTrack = (track: MusicTrack) => {
    try {
      WebApp?.HapticFeedback?.impactOccurred('medium');
    } catch (_) {}

    const currentList = selectedAlbum && albumTracks.length > 0
      ? albumTracks
      : activeTab === 'search' && searchResults.length > 0 
        ? searchResults 
        : favTracks;

    const playlist = currentList.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      url: pickUrl(t),
      coverUrl: t.artworkUrl,
      type: 'music' as const
    }));

    playTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      url: pickUrl(track),
      coverUrl: track.artworkUrl,
      type: 'music'
    }, playlist);

    try {
      // Write-only here: the history UI lives in Favorites → tab «Музыка»
      favoritesManager.addHistory('music', {
        id: track.id,
        name: track.title,
        url: track.audioUrl,
        logo: track.artworkUrl,
        group: track.artist,
        type: 'music'
      });
    } catch (_) {}
  };



  const isCurrentPlayingThis = (id: string) => currentTrack?.id === id && isPlaying;

  return (
    <div className="flex flex-col min-h-full pb-32" style={{ color: 'var(--text-color)' }}>
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

        {/* Traffic Saver toggle: low bitrate (< 320 kbps) for weak/metered connections */}
        <button
          onClick={toggleDataSaver}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold border flex-shrink-0 transition-colors active:scale-95 ${
            dataSaver ? 'bg-[#FA2D48] text-white border-[#FA2D48] shadow-md' : 'hover:opacity-90'
          }`}
          style={!dataSaver ? {
            backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
            borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
            color: 'var(--text-color)'
          } : undefined}
          title={t('music_data_saver_hint') || 'Низкий битрейт для слабого подключения'}
        >
          <span>📶</span>
          <span>{t('music_data_saver') || 'Экономия'}</span>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dataSaver ? 'bg-white' : 'bg-emerald-500'}`} />
        </button>
      </div>

      {/* Unavailable Full Track Feedback Toast */}
      {unavailableToast && (
        <div 
          className="p-3 mb-4 rounded-2xl shadow-xl flex items-center justify-between border backdrop-blur-xl animate-in fade-in slide-in-from-top duration-200"
          style={{
            backgroundColor: 'var(--bg-color)',
            borderColor: '#FA2D48',
            color: 'var(--text-color)'
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base flex-shrink-0">⚠️</span>
            <span className="text-xs font-bold truncate">{unavailableToast}</span>
          </div>
          <button 
            onClick={() => setUnavailableToast(null)}
            className="p-1 opacity-60 hover:opacity-100 text-xs font-black cursor-pointer"
            style={{ color: 'var(--text-color)' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Segmented Navigation: 2 Clean Tabs (Apple HIG) */}
      <div 
        className="flex p-1 rounded-xl mb-4 backdrop-blur-md border"
        style={{
          backgroundColor: 'var(--secondary-bg-color, rgba(120, 120, 128, 0.12))',
          borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.15))'
        }}
      >
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'search' ? 'bg-[#FA2D48] text-white shadow-md' : 'opacity-70 hover:opacity-100'
          }`}
        >
          🔍 {t('music_search') || 'Поиск'}
        </button>
        <button
          onClick={() => setActiveTab('favorites')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'favorites' ? 'bg-[#FA2D48] text-white shadow-md' : 'opacity-70 hover:opacity-100'
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
            className="w-full pl-10 pr-10 py-3 border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FA2D48]"
            style={{
              backgroundColor: 'var(--secondary-bg-color, rgba(120, 120, 128, 0.08))',
              borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
              color: 'var(--text-color)'
            }}
          />
          <div className="absolute left-3.5 top-3.5 opacity-50" style={{ color: 'var(--text-color)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
              style={{
                backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.2))',
                color: 'var(--text-color)'
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Favorites Cache Header Bar */}
      {activeTab === 'favorites' && favTracks.length > 0 && (
        <div 
          className="flex items-center justify-between px-3 py-2 mb-3 rounded-2xl border"
          style={{
            backgroundColor: 'var(--secondary-bg-color, rgba(120, 120, 128, 0.06))',
            borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.12))'
          }}
        >
          <div className="text-xs font-semibold opacity-75 truncate mr-2">
            {cacheStats.count > 0 ? `${t('music_cache')}: ${cacheStats.count} • ${audioOfflineManager.formatBytes(cacheStats.sizeBytes, language)}` : t('music_cache_empty')}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {cacheStats.count > 0 && (
              <button
                onClick={handleExportAll}
                disabled={isExporting}
                className="px-2.5 py-1 rounded-full text-xs font-bold border transition-colors active:scale-95 flex items-center gap-1"
                style={{
                  backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
                  borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
                  color: 'var(--text-color)'
                }}
                title={t('music_to_files') || 'В Файлы'}
              >
                <span>{isExporting ? '⏳' : '📥'}</span>
                <span>{isExporting ? t('music_exporting') : t('music_to_files')}</span>
              </button>
            )}
            {cacheStats.count > 0 && (
              <button
                onClick={handleClearCache}
                className="px-2.5 py-1 rounded-full hover:bg-red-500/20 text-xs font-bold hover:text-red-400 border transition-colors active:scale-95"
                style={{
                  backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
                  borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
                  color: 'var(--text-color)'
                }}
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
            onClick={() => playAllFavorites(true)}
            className="flex-1 py-2 px-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border active:scale-95 transition-all"
            style={{
              backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
              borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
              color: 'var(--text-color)'
            }}
          >
            <span>🔀</span>
            <span>{t('music_shuffle')}</span>
          </button>

          <button
            onClick={() => setIsReorderMode(prev => !prev)}
            className={`py-2 px-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1 border active:scale-95 transition-all ${
              isReorderMode
                ? 'bg-[#FA2D48] text-white border-[#FA2D48] shadow-md'
                : 'hover:opacity-90'
            }`}
            style={!isReorderMode ? {
              backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
              borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
              color: 'var(--text-color)'
            } : undefined}
          >
            <span>{isReorderMode ? '✓' : '⇅'}</span>
            <span>{isReorderMode ? t('music_done') : t('music_reorder')}</span>
          </button>
        </div>
      )}

      {/* Found Albums Horizontal Carousel */}
      {/* Не скрываем карусель альбомов при подгрузке страниц, сохраняя стабильный layout */}
      {activeTab === 'search' && !selectedAlbum && albums.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-extrabold tracking-wider uppercase opacity-60">
              💽 {t('music_albums') || 'Альбомы'}
            </span>
            <span className="text-[11px] opacity-40 font-mono">
              {albums.length}
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar">
            {albums.map((album) => (
              <div
                key={album.id}
                onClick={() => handleSelectAlbum(album)}
                className="flex-shrink-0 w-24 cursor-pointer group active:scale-95 transition-transform"
              >
                <div 
                  className="w-24 h-24 rounded-2xl overflow-hidden shadow-md border relative"
                  style={{
                    borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
                    backgroundColor: 'var(--secondary-bg-color, rgba(120, 120, 128, 0.1))'
                  }}
                >
                  <img
                    src={album.artworkUrl || PLACEHOLDER_ARTWORK}
                    alt={album.title}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_ARTWORK; }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1.5">
                    <span className="text-[10px] text-white font-bold">▶ Открыть</span>
                  </div>
                </div>
                <h4 className="text-xs font-bold truncate mt-1.5" style={{ color: 'var(--text-color)' }}>
                  {album.title}
                </h4>
                <p className="text-[10px] opacity-60 truncate">
                  {album.year ? `${album.year} • ` : ''}{album.artist}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Album Header */}
      {activeTab === 'search' && selectedAlbum && (
        <div 
          className="p-3 mb-4 rounded-2xl border flex items-center justify-between gap-3 shadow-md backdrop-blur-md"
          style={{
            backgroundColor: 'var(--secondary-bg-color, rgba(120, 120, 128, 0.08))',
            borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))'
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img 
              src={selectedAlbum.artworkUrl || PLACEHOLDER_ARTWORK} 
              alt={selectedAlbum.title} 
              loading="lazy"
              decoding="async"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_ARTWORK; }}
              className="w-14 h-14 rounded-xl object-cover shadow border flex-shrink-0"
              style={{ borderColor: 'rgba(255,255,255,0.1)' }}
            />
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#FA2D48]">
                Альбом {selectedAlbum.year ? `• ${selectedAlbum.year}` : ''}
              </span>
              <h3 className="text-sm font-extrabold truncate" style={{ color: 'var(--text-color)' }}>
                {selectedAlbum.title}
              </h3>
              <p className="text-xs opacity-65 truncate mt-0.5">
                {selectedAlbum.artist} • {albumTracks.length} треков
              </p>
            </div>
          </div>
          <button
            onClick={handleBackToSearch}
            className="px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors active:scale-95 flex-shrink-0"
            style={{
              backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
              borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
              color: 'var(--text-color)'
            }}
          >
            ← {t('music_all_tracks') || 'Все треки'}
          </button>
        </div>
      )}

      {/* Section Header for Tracks */}
      {/* Сохраняем заголовок секции видимым во время пагинации */}
      {activeTab === 'search' && !selectedAlbum && searchResults.length > 0 && (
        <div className="mb-2 px-1 flex items-center justify-between">
          <span className="text-xs font-extrabold tracking-wider uppercase opacity-60">
            🎵 {t('music_popular_tracks') || 'Треки'}
          </span>
          <span className="text-[11px] opacity-40 font-mono">
            {searchResults.length}
          </span>
        </div>
      )}

      {/* Track List */}
      {/* Скелетон отображается только при первичном поиске (когда список пуст) или загрузке альбома,
          предотвращая схлопывание высоты контейнера и подброс скролла наверх */}
      <div className="flex flex-col gap-1.5">
        {((loading && searchResults.length === 0) || loadingAlbum) ? (
          <div className="flex flex-col gap-2 py-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2.5 rounded-2xl border animate-pulse"
                style={{
                  backgroundColor: 'var(--secondary-bg-color, rgba(120, 120, 128, 0.04))',
                  borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.08))'
                }}
              >
                <div className="w-12 h-12 rounded-xl bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-white/10 rounded w-2/3" />
                  <div className="h-2.5 bg-white/5 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          (() => {
            const list = selectedAlbum ? albumTracks : (activeTab === 'search' ? searchResults : favTracks);

            if (list.length === 0) {
              if (activeTab === 'search') {
                // History moved to Favorites → «Музыка»; search screen stays clean
                if (searchQuery.trim().length < 2) {
                  return (
                    <div className="text-center py-16 opacity-50 font-medium text-sm flex flex-col items-center gap-2">
                      <span className="text-3xl">🎵</span>
                      <span>{t('music_search_prompt') || 'Поиск музыки'}</span>
                    </div>
                  );
                }
                return (
                  <div className="text-center py-16 opacity-50 font-medium text-sm flex flex-col items-center gap-2">
                    <span className="text-3xl">🎵</span>
                    <span>{t('music_no_results') || 'Ничего не найдено'}</span>
                  </div>
                );
              }
              return (
                <div className="text-center py-16 opacity-50 font-bold text-sm">
                  {t('music_no_favorites') || 'В избранном пока нет треков'}
                </div>
              );
            }

            return list.map((track, idx) => {
              const isThisPlaying = isCurrentPlayingThis(track.id);
              const isTrackSelected = currentTrack?.id === track.id;
              const isResolving = Boolean(isTrackSelected && isBuffering && !isThisPlaying);
              const isFav = favIds.has(track.id);
              const isOffline = cachedUrls.has(track.audioUrl) || cachedUrls.has(track.id);

              return (
                <div
                  key={track.id}
                  onClick={() => {
                    if (isReorderMode && activeTab === 'favorites') return;
                    if (isResolving) return; // prefetch in flight — ignore double-tap
                    handleSelectTrack(track);
                  }}
                  className={`flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer transition-all active:scale-[0.99] border ${
                    isTrackSelected 
                      ? 'ring-2 ring-[#FA2D48] border-[#FA2D48]/50 shadow-md' 
                      : 'hover:opacity-90'
                  }`}
                  style={{
                    backgroundColor: isTrackSelected
                      ? 'rgba(250, 45, 72, 0.12)'
                      : 'var(--secondary-bg-color, rgba(120, 120, 128, 0.06))',
                    borderColor: isTrackSelected ? 'rgba(250, 45, 72, 0.4)' : 'var(--hint-color, rgba(150, 150, 150, 0.12))',
                    color: 'var(--text-color)'
                  }}
                >
                  {/* Reorder index in favorites */}
                  {activeTab === 'favorites' && isReorderMode && (
                    <span className="w-5 text-center text-xs font-black text-[#FA2D48]">
                      {idx + 1}
                    </span>
                  )}

                  {/* Artwork with squircle */}
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 shadow-sm" style={{ backgroundColor: 'var(--hint-color, rgba(120,120,128,0.2))' }}>
                    <img 
                      src={track.artworkUrl || PLACEHOLDER_ARTWORK} 
                      alt={track.title} 
                      className="w-full h-full object-cover" 
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_ARTWORK; }}
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
                    {isResolving && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold truncate" style={{ color: isTrackSelected ? '#FA2D48' : 'var(--text-color)' }}>
                        {track.title}
                      </h3>
                      {isOffline && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 font-extrabold flex-shrink-0">
                          {t('music_offline')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs truncate" style={{ color: 'var(--text-color)', opacity: 0.65 }}>
                        {track.artist}
                      </p>
                      {track.duration && track.duration > 35 && (
                        <>
                          <span className="text-[10px] opacity-30">•</span>
                          <span className="text-[11px] font-mono opacity-50 flex-shrink-0" style={{ color: 'var(--text-color)' }}>
                            {formatTrackDuration(track.duration)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Reorder Up/Down Controls or Export/Heart */}
                  {activeTab === 'favorites' && isReorderMode ? (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => moveTrack(idx, -1)}
                        disabled={idx === 0}
                        className="w-8 h-8 rounded-full disabled:opacity-20 flex items-center justify-center text-xs font-black active:scale-90 transition-all border"
                        style={{
                          backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
                          borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
                          color: 'var(--text-color)'
                        }}
                        title={t('music_move_up')}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveTrack(idx, 1)}
                        disabled={idx === favTracks.length - 1}
                        className="w-8 h-8 rounded-full disabled:opacity-20 flex items-center justify-center text-xs font-black active:scale-90 transition-all border"
                        style={{
                          backgroundColor: 'var(--hint-color, rgba(120, 120, 128, 0.15))',
                          borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.2))',
                          color: 'var(--text-color)'
                        }}
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
                          className="p-2 opacity-60 hover:opacity-100 transition-opacity active:scale-90 flex-shrink-0"
                          style={{ color: 'var(--text-color)' }}
                          title={t('music_to_files') || 'В Файлы'}
                        >
                          {exportingTrackId === track.id ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
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
                        style={{ color: isFav ? '#FA2D48' : 'var(--hint-color, rgba(150,150,150,0.5))' }}
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

        {/* Infinite Scroll Sentinel: подгрузка треков при приближении к концу списка */}
        {activeTab === 'search' && !selectedAlbum && searchResults.length > 0 && hasMoreSearch && (
          <div ref={sentinelCallbackRef} className="py-4 flex flex-col items-center justify-center gap-2">
            {loadingMore ? (
              <div className="w-6 h-6 border-2 border-[#FA2D48] border-t-transparent rounded-full animate-spin" />
            ) : (
              <button
                type="button"
                onClick={() => loadMoreTracks()}
                className="text-xs px-3 py-1.5 rounded-xl border opacity-50 hover:opacity-100 transition-opacity"
                style={{
                  backgroundColor: 'var(--secondary-bg-color, rgba(120, 120, 128, 0.08))',
                  borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.15))',
                  color: 'var(--text-color)'
                }}
              >
                {t('music_load_more') || 'Загрузить ещё'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Studio Equalizer Sheet */}
    </div>
  );
}
