import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { Player } from '../components/Player';
import { useAdManager } from '../context/AdManager';
import { ExoClickMainBanner } from '../components/ExoClickMainBanner';
import { useApi, EXPRESS_API_BASE, CF_API_BASE, getTmdbImageUrl } from '../hooks/useApi';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { usePlaybackResilience } from '../hooks/usePlaybackResilience';
import { TrailerModal } from '../components/TrailerModal';
import { PersonModal } from '../components/PersonModal';
import { useViewportExpand } from '../hooks/useViewportExpand';
import { trackOpen } from '../utils/analytics';
import { favoritesManager } from '../utils/favoritesManager';
import { clientCache } from '../utils/clientCache';

export function Movie() {
  const { id } = useParams();
  useViewportExpand([id]);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchMovieDetails, fetchPersonDetails, fetchRecommendations, loading } = useApi();
  const { t, language } = useLanguage();
  const { stop: stopAudio } = useAudioPlayer();
  const { triggerMovieAd } = useAdManager();
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [sources, setSources] = useState<{name: string, url: string, label?: string, isLiftw?: boolean, episodes?: any}[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [movie, setMovie] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
  const [liftwEpisodes, setLiftwEpisodes] = useState<any>(null);
  const [activeSeason, setActiveSeason] = useState<string>('');
  const [activeEpisode, setActiveEpisode] = useState<string>('');

  // Validate media type
  const queryType = searchParams.get('type');
  const isTvSeries = queryType === 'series' || queryType === 'tv' || movie?.type === 'series' || movie?.type === 'tv' || (movie?.seasons && movie.seasons.length > 0) || Boolean(liftwEpisodes && Object.keys(liftwEpisodes).length > 0);
  const mediaType = isTvSeries ? 'tv' : 'movie';
  const favType = isTvSeries ? 'series' : 'movie';

  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (movie?.id) {
      setIsFavorite(favoritesManager.isFavorite(favType, movie.id));
    }
  }, [movie?.id, favType]);

  const handleToggleFavorite = () => {
    if (!movie?.id) return;
    if (isFavorite) {
      favoritesManager.remove(favType, movie.id);
      setIsFavorite(false);
      try {
        WebApp?.HapticFeedback?.impactOccurred('light');
      } catch (_) {}
    } else {
      favoritesManager.add(favType, {
        id: movie.id,
        title: movie.title,
        poster: movie.poster,
        rating: movie.rating,
        year: movie.year,
        type: favType,
      });
      setIsFavorite(true);
      try {
        WebApp?.HapticFeedback?.impactOccurred('medium');
      } catch (_) {}
    }
  };

  // Compute composite key for series episodes so each episode retains its own independent timecode
  const currentMediaKey = useMemo(() => {
    if (!id) return '';
    if (isTvSeries && (activeSeason || activeEpisode)) {
      return `${id}_s${activeSeason || '1'}_e${activeEpisode || '1'}`;
    }
    return String(id);
  }, [id, isTvSeries, activeSeason, activeEpisode]);

  const { savedTimecode, saveTimecode } = usePlaybackResilience({ mediaId: currentMediaKey });

  const sortedSeasons = useMemo<string[]>(() => {
    if (liftwEpisodes && Object.keys(liftwEpisodes).length > 0) {
      return Object.keys(liftwEpisodes).sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    // Fallback to TMDB seasons metadata if available
    if (movie?.seasons && Array.isArray(movie.seasons)) {
      const valid: string[] = movie.seasons
        .filter((s: any) => s.season_number > 0)
        .map((s: any) => String(s.season_number));
      if (valid.length > 0) return valid;
    }
    return ['1'];
  }, [liftwEpisodes, movie?.seasons]);

  const sortedEpisodes = useMemo<string[]>(() => {
    const currentSeason = activeSeason || (sortedSeasons[0] || '1');
    if (liftwEpisodes?.[currentSeason] && Array.isArray(liftwEpisodes[currentSeason])) {
      return liftwEpisodes[currentSeason].slice().sort((a: string, b: string) => {
        const numA = parseInt(String(a), 10);
        const numB = parseInt(String(b), 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    // Fallback to TMDB episode_count
    if (movie?.seasons && Array.isArray(movie.seasons)) {
      const sInfo = movie.seasons.find((s: any) => String(s.season_number) === currentSeason);
      if (sInfo && sInfo.episode_count > 0) {
        return Array.from({ length: sInfo.episode_count }, (_, i) => String(i + 1));
      }
    }
    return ['1'];
  }, [liftwEpisodes, activeSeason, sortedSeasons, movie?.seasons]);
  const [showTrailerModal, setShowTrailerModal] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<number | string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userSelectedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [contentUnavailable, setContentUnavailable] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [isReported, setIsReported] = useState(false);

  const formatRuntime = (minutes: number) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const trailerVideo = useMemo(() => movie?.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') || movie?.videos?.results?.[0], [movie?.videos]);
  const directors = useMemo(() => movie?.credits?.crew?.filter((c: any) => c.job === 'Director') || [], [movie?.credits?.crew]);
  const writers = useMemo(() => movie?.credits?.crew?.filter((c: any) => c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Characters')?.slice(0, 3) || [], [movie?.credits?.crew]);
  const cast = useMemo(() => movie?.credits?.cast?.slice(0, 15) || [], [movie?.credits?.cast]);
  const ratingPct = useMemo(() => movie?.rating ? Math.round(movie.rating * 10) : 0, [movie?.rating]);
  const isUnreleased = useMemo(() => Boolean(
    movie?.isUpcoming || 
    (movie?.release_date && new Date(movie.release_date).getTime() > Date.now())
  ), [movie?.isUpcoming, movie?.release_date]);

  const handleReportMissing = async () => {
    if (!movie || isReporting || isReported) return;
    setIsReporting(true);
    try {
      let platform = 'Web / Browser';
      if (WebApp && WebApp.platform && WebApp.platform !== 'unknown') {
        platform = `Telegram WebApp (${WebApp.platform})`;
      } else if (/android/i.test(navigator.userAgent)) {
        platform = 'Android App / Browser';
      } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
        platform = 'iOS / Safari';
      }

      await fetch(`${EXPRESS_API_BASE}/report-missing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (movie as any)?.title || (movie as any)?.name || '',
          year: String((movie as any)?.year || ''),
          type: mediaType,
          tmdb_id: String((movie as any)?.id || id || ''),
          sources_failed: ['Liftw (404 / Unavailable)', 'Anwap (404 / Unavailable)'],
          platform
        })
      });

      setIsReported(true);
      try {
        if (WebApp?.HapticFeedback) {
          WebApp.HapticFeedback.notificationOccurred('success');
        }
      } catch (_) {}
    } catch (err) {
      console.error('Failed to submit missing report', err);
      setIsReported(true);
    } finally {
      setIsReporting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // PostMessage event listener for timecode tracking and explicit 404/not_found stream fallback
  useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      // Validate trusted player origins
      if (!event.origin || (!event.origin.includes('liftw.ws') && !event.origin.includes('zenithjs.ws') && !event.origin.includes('ortified.ws') && !event.origin.includes(window.location.hostname))) {
        return;
      }

      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data) return;

        // Timecode tracking for playback position resilience
        if (data.event === 'timeupdate' || data.type === 'timeupdate' || data.event === 'time' || data.type === 'time') {
          const time = data.time || data.currentTime || data.position;
          if (typeof time === 'number' && time > 0 && currentMediaKey) {
            saveTimecode(currentMediaKey, time);
          }
        }

        // Only trigger fallback if the stream is genuinely non-existent (404/not_found),
        // NEVER on transient HLS buffer stalls, bitrate switching, or ad-block warnings
        const isFatalNotFound = 
          data.error === 'not_found' ||
          data.event === 'not_found' ||
          data.status === 404 ||
          (typeof data.error === 'string' && data.error.toLowerCase().includes('not found'));

        if (isFatalNotFound && iframeUrl === sources[0]?.url) {
          console.log('[PlayerFallback] Fatal stream not-found signal received, switching to backup...');
          if (sources.length > 1 && sources[1]?.url) {
            setIframeUrl(sources[1].url);
          } else {
            setContentUnavailable(true);
          }
        }
      } catch (e) {
        // Ignore non-JSON postMessage payloads
      }
    };

    window.addEventListener('message', handlePlayerMessage);
    return () => window.removeEventListener('message', handlePlayerMessage);
  }, [currentMediaKey, iframeUrl, saveTimecode, sources]);

  const handleSeasonEpisodeChange = (season: string, episode: string) => {
    setActiveSeason(season);
    setActiveEpisode(episode);

    setIframeUrl(prev => {
      if (!prev) return prev;
      try {
        const urlObj = new URL(prev);
        urlObj.searchParams.set('season', season);
        urlObj.searchParams.set('episode', episode);
        return urlObj.toString();
      } catch (_) {
        if (prev.includes('season=')) {
          return prev.replace(/season=\d+/, `season=${season}`).replace(/episode=\d+/, `episode=${episode}`);
        }
        return `${prev}${prev.includes('?') ? '&' : '?'}season=${season}&episode=${episode}`;
      }
    });

    const iframe = document.getElementById('video-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      try {
        const iframeOrigin = new URL(iframe.src).origin;
        iframe.contentWindow.postMessage({ event: 'playlist go', season: parseInt(season), episode: parseInt(episode) }, iframeOrigin);
      } catch (_) {}
    }
  };

  useEffect(() => {
    if (iframeUrl) {
      setShowTooltip(true);
      const timer = setTimeout(() => setShowTooltip(false), 15000);
      return () => clearTimeout(timer);
    }
  }, [iframeUrl]);

  useEffect(() => {
    let interval: any;
    if (isExtracting) {
      setLoadingProgress(0);
      interval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 90) {
            clearInterval(interval);
            return 90;
          }
          return prev + Math.random() * 10;
        });
      }, 500);
    } else {
      setLoadingProgress(100);
    }
    return () => clearInterval(interval);
  }, [isExtracting]);

  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    
    const loadData = async () => {
      setIframeUrl(null);
      setSources([]);
      setIsExtracting(false);
      setContentUnavailable(false);
      setMovie(null);
      userSelectedRef.current = false;
      try {
        const initialType = (queryType === 'series' || queryType === 'tv') ? 'tv' : 'movie';
        const details = await fetchMovieDetails(id, initialType);
        if (!isMounted) return;
        setMovie(details);
        const d = details as any;
        const resolvedType = (d?.type === 'series' || d?.type === 'tv' || initialType === 'tv') ? 'tv' : 'movie';
        trackOpen(resolvedType === 'tv' ? 'series' : 'movie', d?.title || d?.name || '', id);
        const recs = await fetchRecommendations(id, resolvedType);
        if (isMounted) {
          setRecommendations(recs || []);
        }

        // Instant check in clientCache for stream and episodes
        const streamCacheKey = `liftw_stream_v2_${id}_${resolvedType}`;
        const cachedStream = clientCache.get<any>(streamCacheKey);
        if (cachedStream?.episodes && isMounted) {
          setLiftwEpisodes(cachedStream.episodes);
        } else if (resolvedType === 'tv') {
          // Non-blocking background pre-fetch for TV series so episodes are ready before click
          const bgQuery = new URLSearchParams({
            title: d?.title || d?.name || '',
            year: d?.year || '',
            type: 'tv',
            tmdb: String(id),
            title_ru: language === 'ru-RU' ? (d?.title || '') : '',
            original_title: d?.original_title || '',
          }).toString();

          const cfP = fetchWithRetry(`${CF_API_BASE}/liftw?${bgQuery}`, { maxRetries: 1, baseDelayMs: 200 }).then(r => r.ok ? r.json() : null).catch(() => null);
          const hfP = fetchWithRetry(`${EXPRESS_API_BASE}/liftw?${bgQuery}`, { maxRetries: 1, baseDelayMs: 200 }).then(r => r.ok ? r.json() : null).catch(() => null);
          Promise.any([cfP, hfP]).then((data: any) => {
            if (data && data.iframe && isMounted) {
              clientCache.set(streamCacheKey, data, 7200);
              if (data.episodes) {
                setLiftwEpisodes(data.episodes);
              }
            }
          }).catch(() => {});
        }
      } catch (err) {
        console.error("Failed to load movie data", err);
      }
    };
    
    loadData();
    window.scrollTo(0, 0);
    
    return () => {
      isMounted = false;
    };
  }, [id, queryType, fetchMovieDetails, fetchRecommendations]);

  // Trigger ad when navigating to movie
  useEffect(() => {
    triggerMovieAd();
  }, [id, triggerMovieAd]); // re-trigger when movie id changes

  const handleWatch = async (forceRefresh = false) => {
    if (!movie) return;
    const isUnreleased = Boolean(
      movie?.isUpcoming || 
      (movie?.release_date && new Date(movie.release_date).getTime() > Date.now())
    );
    if (isUnreleased) {
      if (trailerVideo) {
        stopAudio();
        setShowTrailerModal(true);
      }
      return;
    }
    
    // Stop background music/radio strictly when the user initiates video playback
    stopAudio();

    // Add to history
    try {
      const historyKey = mediaType === 'tv' ? 'history_series' : 'history_movies';
      let hist = JSON.parse(localStorage.getItem(historyKey) || '[]');
      hist = hist.filter((item: any) => item.id !== movie.id);
      hist.unshift({
        id: movie.id,
        title: movie.title,
        poster: movie.poster,
        type: mediaType === 'tv' ? 'series' : 'movie',
        year: movie.year,
        rating: movie.rating
      });
      if (hist.length > 30) {
        hist = hist.slice(0, 30);
      }
      localStorage.setItem(historyKey, JSON.stringify(hist));
    } catch (e) {
      console.error('Failed to save to history:', e);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsExtracting(true);
    setIframeUrl(null);
    setSources([]);
    setContentUnavailable(false);
    userSelectedRef.current = false;
    
    // Scroll to player placeholder immediately
    setTimeout(() => {
      document.getElementById('video-player-container')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const queryParams: Record<string, string> = {
        title: (movie as any).title || (movie as any).name || '',
        year: (movie as any).year || '',
        type: mediaType,
        tmdb: (movie as any).id?.toString() || '',
        imdb: (movie as any).imdb_id || ''
      };

      const originalTitle = (movie as any)?.original_title || (movie as any)?.original_name || '';
      const ruTitle = (movie as any)?.title_ru || (movie as any)?.title || (movie as any)?.name || queryParams.title;

      // Parallel fetch: Liftw + Anwap
      const liftwQuery = new URLSearchParams({
        title: queryParams.title,
        year: queryParams.year,
        type: queryParams.type,
        tmdb: queryParams.tmdb,
        title_ru: ruTitle,
        original_title: originalTitle
      });
      if (forceRefresh) {
        liftwQuery.append('bypass_cache', 'true');
      }

      const foundSources: { liftw: any, anwap: any[] } = { 
        liftw: null, 
        anwap: []
      };

      let isLiftwDone = false;
      let anwapDone = false;

      const evaluateUIUnblock = () => {
        if (foundSources.liftw || isLiftwDone || anwapDone) {
          setIsExtracting(false);
        }
      };

      const updateUI = () => {
        const combined: any[] = [];
        
        // Player 1: Liftw (Primary player with built-in audio/subtitles language switcher — Priority #1)
        if (foundSources.liftw) {
          combined.push({
            name: 'player1',
            label: t('player1') || 'Плеер 1',
            url: foundSources.liftw.url,
            isLiftw: true
          });
        }
        
        // Player 2: Anwap (Direct MP4 backup stream)
        if (foundSources.anwap.length > 0) {
          combined.push({
            name: 'player2',
            label: t('player2') || 'Плеер 2',
            url: foundSources.anwap[0].url,
            isLiftw: false
          });
        }

        setSources(combined);

        if (combined.length > 0) {
          // Priority 1: If Liftw (1080p) is found, it is ALWAYS the preferred player.
          // Never preemptively mount backup player (Anwap) while Liftw is still resolving!
          if (foundSources.liftw) {
            const preferredUrl = foundSources.liftw.url;
            if (!userSelectedRef.current) {
              setIframeUrl(preferredUrl);
            } else {
              setIframeUrl(prev => prev || preferredUrl);
            }
            setIsExtracting(false);
          } else if (isLiftwDone && foundSources.anwap.length > 0) {
            const preferredUrl = foundSources.anwap[0].url;
            if (!userSelectedRef.current) {
              setIframeUrl(preferredUrl);
            } else {
              setIframeUrl(prev => prev || preferredUrl);
            }
            setIsExtracting(false);
          }
        }
      };

      // 2. Fetch liftw asynchronously (Primary Player — Priority #1, 1080p)
      const fetchLiftw = async () => {
        const start = performance.now();
        try {
          const streamCacheKey = `liftw_stream_v2_${id}_${mediaType}`;
          const queryStr = liftwQuery.toString();

        // Instant 0ms read from client cache
        let liftwData: any = !forceRefresh ? clientCache.get<any>(streamCacheKey) : null;

        if (!liftwData) {
          const tryFetchLiftw = async (baseUrl: string, timeoutMs: number) => {
            const timeoutCtrl = new AbortController();
            const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
            try {
              const res = await fetchWithRetry(`${baseUrl}/liftw?${queryStr}`, {
                maxRetries: 1,
                baseDelayMs: 200,
                maxDelayMs: 600,
                signal: timeoutCtrl.signal,
              });
              clearTimeout(timeoutId);
              if (!res.ok) return null;
              return await res.json();
            } catch (_) {
              clearTimeout(timeoutId);
              return null;
            }
          };

          try {
            // Parallel race: Query Cloudflare Edge and HF microservice simultaneously
            const cfPromise = tryFetchLiftw(CF_API_BASE, 5000);
            const hfPromise = tryFetchLiftw(EXPRESS_API_BASE, 5000);

            liftwData = await Promise.any([
              cfPromise.then(res => (res && res.iframe ? res : Promise.reject())),
              hfPromise.then(res => (res && res.iframe ? res : Promise.reject())),
            ]).catch(async () => {
              return (await cfPromise) || (await hfPromise);
            });

            if (liftwData && liftwData.iframe) {
              clientCache.set(streamCacheKey, liftwData, 7200); // 2 hours client cache
            }
          } catch (e) {
            console.error("Liftw fetch failed", e);
          }
        }

        if (liftwData && liftwData.iframe) {
          // If the user already selected a specific season/episode, ensure the initial URL reflects it
          let initialUrl = liftwData.iframe;
          if (mediaType === 'tv') {
            const targetSeason = activeSeason || (sortedSeasons[0] || '1');
            const targetEpisode = activeEpisode || (sortedEpisodes[0] || '1');
            try {
              const u = new URL(initialUrl);
              u.searchParams.set('season', targetSeason);
              u.searchParams.set('episode', targetEpisode);
              initialUrl = u.toString();
            } catch (_) {}
          }

          foundSources.liftw = { name: 'player1', url: initialUrl, isLiftw: true };
          
          if (liftwData.episodes) {
            setLiftwEpisodes(liftwData.episodes);
            const initSortedSeasons = Object.keys(liftwData.episodes).sort((a, b) => {
              const numA = parseInt(a, 10);
              const numB = parseInt(b, 10);
              if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
              return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });
            const firstSeason = initSortedSeasons[0] || '1';

            setActiveSeason(prevSeason => {
              if (prevSeason && liftwData.episodes[prevSeason]) return prevSeason;
              return firstSeason;
            });
            setActiveEpisode(prevEp => {
              const targetSeason = firstSeason;
              const eps = Array.isArray(liftwData.episodes[targetSeason]) ? liftwData.episodes[targetSeason] : [];
              const sortedInitEps = eps.slice().sort((a: any, b: any) => {
                const numA = parseInt(String(a), 10);
                const numB = parseInt(String(b), 10);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
              });
              if (prevEp && sortedInitEps.includes(prevEp)) return prevEp;
              return sortedInitEps[0] || '1';
            });
          }

          // Liftw source is Priority #1: Immediately render Player 1 and unblock UI
          updateUI();
          setIsExtracting(false);
        }
      } finally {
        const end = performance.now();
        console.log(`[Perf] Liftw fetch completed in ${((end - start) / 1000).toFixed(2)}s`);
      }
      };

      // 3. Fetch Anwap stream asynchronously (Player 2 — Backup)
      const fetchAnwap = async () => {
        const start = performance.now();
        const timeoutCtrl = new AbortController();
        const timeoutId = setTimeout(() => timeoutCtrl.abort(), 7000);
        try {
          const titlesToTry: string[] = [];
          const ru = (movie as any)?.title_ru || (movie as any)?.title || (movie as any)?.name || queryParams.title;
          const orig = (movie as any)?.original_title || (movie as any)?.original_name || queryParams.original_title;
          if (ru) titlesToTry.push(ru.trim());
          if (orig && orig.trim() !== ru?.trim()) titlesToTry.push(orig.trim());
          if (queryParams.title && !titlesToTry.includes(queryParams.title.trim())) titlesToTry.push(queryParams.title.trim());

          let foundUrl = '';
          for (const candTitle of titlesToTry) {
            try {
              const res = await fetchWithRetry(`${EXPRESS_API_BASE}/anwap?title=${encodeURIComponent(candTitle)}`, {
                maxRetries: 1,
                baseDelayMs: 250,
                maxDelayMs: 800,
                signal: timeoutCtrl.signal,
              });
              if (res.ok) {
                const data = await res.json();
                if (data && data.url && /^https?:\/\//i.test(data.url)) {
                  foundUrl = data.url;
                  break;
                }
              }
            } catch (_) {}
          }

          if (foundUrl) {
            foundSources.anwap = [{ name: 'anwap', url: foundUrl, isLiftw: false }];
            updateUI();
          }
        } catch (e) {
          console.error("Anwap fetch failed", e);
        } finally {
          clearTimeout(timeoutId);
          const end = performance.now();
          console.log(`[Perf] Anwap fetch completed in ${((end - start) / 1000).toFixed(2)}s`);
        }
      };

      // 10s UI deadline: if neither source responds, stop spinner and show unavailable
      const uiDeadline = setTimeout(() => {
        if (foundSources.liftw === null && foundSources.anwap.length === 0) {
          setIsExtracting(false);
          setContentUnavailable(true);
        }
      }, 10000);

      // Fetch primary and secondary player sources in parallel without blocking UI
      fetchLiftw().then(() => {
        updateUI();
        evaluateUIUnblock();
      }).finally(() => {
        isLiftwDone = true;
        updateUI(); // Immediately trigger Anwap fallback if Liftw has no stream
        if (isLiftwDone && anwapDone) {
          clearTimeout(uiDeadline);
          setIsExtracting(false);
          if (foundSources.liftw === null && foundSources.anwap.length === 0) {
            setContentUnavailable(true);
          }
        }
      });

      fetchAnwap().then(() => {
        updateUI();
        evaluateUIUnblock();
      }).finally(() => {
        anwapDone = true;
        updateUI(); // Immediately trigger UI update when Anwap resolves
        if (isLiftwDone && anwapDone) {
          clearTimeout(uiDeadline);
          setIsExtracting(false);
          if (foundSources.liftw === null && foundSources.anwap.length === 0) {
            setContentUnavailable(true);
          }
        }
      });
    } catch (err) {
      console.error("Failed to extract stream", err);
      alert("Failed to load stream");
    } finally {
      setTimeout(() => {
        document.getElementById('video-player-container')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  };

  if (loading && !movie) {
    return (
      <div className="p-4 pt-24 pb-20 flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium opacity-50">{t('loading')}</div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="p-4 pt-24 pb-20 flex flex-col items-center justify-center min-h-[50vh]">
        <div className="text-4xl mb-2">🎬</div>
        <div className="font-medium opacity-70 mb-4">{t('movieNotFound')}</div>
      </div>
    );
  }



  return (
    <div className="pb-32 sm:pb-36 animate-fade-in">
      <div className="relative">
        <img 
          src={movie.backdrop || movie.poster} 
          alt={movie.title} 
          className="w-full aspect-[16/9] max-h-[50vh] object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-color)] via-[var(--bg-color)]/40 to-transparent"></div>
      </div>

      <div className="-mt-20 relative z-10 p-4">
        <div className="flex justify-between items-start mb-3">
          <div>
            <h1 className="text-3xl font-black leading-tight drop-shadow-md">{movie.title}</h1>
            <p className="text-sm opacity-70 font-semibold">{movie.year}</p>
          </div>
          <div className="flex gap-2 relative z-50">
            <button 
              onClick={handleToggleFavorite}
              title={isFavorite ? (t('removeFromFavorites') || 'Удалить из избранного') : (t('addToFavorites') || 'В избранное')}
              style={{ 
                backgroundColor: isFavorite ? 'rgba(245, 158, 11, 0.2)' : 'var(--hint-color)', 
                color: isFavorite ? '#f59e0b' : 'var(--text-color)',
                border: isFavorite ? '1px solid rgba(245, 158, 11, 0.4)' : 'none'
              }}
              className="p-3 rounded-full shadow-lg active:scale-95 transition-all flex-shrink-0 flex items-center justify-center"
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill={isFavorite ? "#f59e0b" : "none"} 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>

            <button 
              onClick={() => setShowShareMenu(!showShareMenu)}
              style={{ backgroundColor: 'var(--hint-color)', color: 'var(--button-color)' }}
              className="p-3 rounded-full shadow-lg active:scale-95 transition-transform flex-shrink-0"
            >
              ➦
            </button>

            {showShareMenu && (
              <div 
                className="absolute top-14 right-0 shadow-2xl rounded-xl p-3 w-52 flex flex-col gap-2 border"
                style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--hint-color)' }}
              >
                <button
                  onClick={() => {
                    setShowShareMenu(false);
                    const tgLink = `https://t.me/M_Box_bot/app?startapp=${mediaType}_${movie?.id}`;
                    const text = `Watch "${movie?.title}" for free on MediaBox!`;
                    WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(tgLink)}&text=${encodeURIComponent(text)}`);
                  }}
                  className="flex items-center gap-3 p-2 text-sm font-semibold rounded-lg hover:opacity-80 active:opacity-60 transition-all text-left"
                  style={{ color: '#0088cc' }}
                >
                  <span className="text-lg">🚀</span> Share to Telegram
                </button>
                
                <div className="h-px w-full" style={{ backgroundColor: 'var(--hint-color)' }}></div>
                
                <button
                  onClick={() => {
                    setShowShareMenu(false);
                    const webLink = `https://media-box.xyz/movie/${movie?.id}?type=${mediaType}`;
                    navigator.clipboard.writeText(webLink).then(() => {
                      WebApp.HapticFeedback.notificationOccurred('success');
                      if (WebApp.showAlert) WebApp.showAlert('Link copied to clipboard!');
                      else alert('Link copied to clipboard!');
                    });
                  }}
                  className="flex items-center gap-3 p-2 text-sm font-semibold rounded-lg hover:opacity-80 active:opacity-60 transition-all text-left"
                  style={{ color: 'var(--text-color)' }}
                >
                  <span className="text-lg">🔗</span> Copy Link
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Sub-header info (Age certification, Genres, Runtime) */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold opacity-90 mb-4">
          {movie.certification && (
            <span className="border border-white/30 bg-white/10 px-1.5 py-0.5 rounded text-[11px] font-bold">
              {movie.certification}
            </span>
          )}
          {movie.release_date && <span>{movie.release_date}</span>}
          {movie.genre && <span>• {movie.genre}</span>}
          {movie.runtime > 0 && <span>• {formatRuntime(movie.runtime)}</span>}
        </div>

        {/* Rating & Trailer Action Bar */}
        <div className="flex items-center gap-4 mb-6">
          {ratingPct > 0 && (
            <div className="flex items-center gap-2 bg-black/40 border border-white/10 px-3 py-1.5 rounded-full shadow-inner">
              <div className="w-8 h-8 rounded-full border-2 border-green-400 flex items-center justify-center font-extrabold text-xs text-green-400">
                {ratingPct}%
              </div>
              <span className="text-xs font-bold opacity-80">{t('tmdbRating')}</span>
            </div>
          )}

          {trailerVideo && (
            <button
              onClick={() => {
                stopAudio();
                setShowTrailerModal(true);
              }}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 px-3.5 py-2 rounded-full text-xs font-bold transition-all active:scale-95 shadow"
            >
              ▶ {t('playTrailer')}
            </button>
          )}
        </div>

        {/* Tagline / Слоган */}
        {movie.tagline && (
          <p className="italic text-2xl sm:text-3xl font-black opacity-95 mb-6 font-serif leading-snug drop-shadow-md text-amber-200/90">
            «{movie.tagline}»
          </p>
        )}

        {contentUnavailable && !isExtracting && !iframeUrl && (
          <div className="mb-6 p-6 rounded-2xl text-center space-y-4" style={{ backgroundColor: 'var(--hint-color)' }}>
            <div className="text-4xl">🎬</div>
            <p className="font-bold text-lg" style={{ color: 'var(--text-color)' }}>
              {t('contentUnavailable') || 'Контент временно недоступен'}
            </p>
            <p className="text-sm opacity-70 max-w-md mx-auto" style={{ color: 'var(--text-color)' }}>
              {t('contentUnavailableDesc') || 'Фильм не найден на доступных источниках. Сообщите нам, и мы оперативно проверим.'}
            </p>
            <div className="flex flex-col items-center gap-3 pt-2">
              <button
                onClick={handleReportMissing}
                disabled={isReporting || isReported}
                className={`w-full sm:w-auto px-6 py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95 shadow flex items-center justify-center gap-2 ${
                  isReported
                    ? 'bg-green-600/30 text-green-400 border border-green-500/40 cursor-default'
                    : 'cursor-pointer'
                }`}
                style={!isReported ? { backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' } : undefined}
              >
                {isReporting
                  ? (t('reportSending') || 'Отправка...')
                  : isReported
                    ? '✅ ' + (t('reportSent') || 'Уведомление отправлено разработчику')
                    : '📩 ' + (t('reportToDev') || 'Отправить уведомление разработчику')}
              </button>
              
              <button
                onClick={() => navigate('/')}
                className="text-xs font-semibold opacity-70 hover:opacity-100 transition-opacity mt-1 cursor-pointer"
                style={{ color: 'var(--text-color)' }}
              >
                ← {t('chooseAnother') || 'Выбрать другой фильм'}
              </button>
            </div>
          </div>
        )}

        {!isExtracting && !iframeUrl && !contentUnavailable && (
          <div className="flex flex-col gap-3 mb-6">
            {isUnreleased ? (
              <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-col gap-3">
                <div className="flex items-center gap-2.5 text-amber-400 font-bold text-sm">
                  <span className="text-xl">🗓️</span>
                  <div>
                    <p>{t('unreleasedMovie') || 'Фильм ещё не вышел в кинотеатрах'}</p>
                    {movie.release_date && (
                      <p className="text-xs font-medium opacity-80 mt-0.5">
                        {t('premiereDate') || 'Премьера'}: {movie.release_date}
                      </p>
                    )}
                  </div>
                </div>
                
                {trailerVideo ? (
                  <button
                    onClick={() => {
                      stopAudio();
                      setShowTrailerModal(true);
                    }}
                    className="w-full py-3.5 rounded-xl font-bold text-base transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg bg-amber-500 text-black hover:bg-amber-400"
                  >
                    ▶ {t('watchTrailerOfficial') || 'Смотреть трейлер'}
                  </button>
                ) : (
                  <p className="text-xs opacity-70 italic text-center py-1">
                    {t('inProductionDesc') || 'Фильм находится на стадии производства. Официальный трейлер появится позже.'}
                  </p>
                )}
              </div>
            ) : (
              <button
                onClick={() => handleWatch(false)}
                className="w-full py-4 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
              >
                ▶ {t('watch')}
              </button>
            )}
          </div>
        )}

        {/* Overview / Обзор */}
        <div className="mb-6 space-y-1">
          <h3 className="font-extrabold text-base">{t('overview')}</h3>
          <p className="text-[14px] opacity-90 leading-relaxed font-medium">
            {movie.description || t('descriptionMissing')}
          </p>
        </div>

        {/* Creators / Создатели */}
        {(directors.length > 0 || writers.length > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6 border-t border-white/10 pt-4 text-xs">
            {directors.map((d: any) => (
              <div
                key={d.id}
                onClick={() => setSelectedPersonId(d.id)}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                <p className="font-extrabold text-sm">{d.name}</p>
                <p className="opacity-60">{t('director')}</p>
              </div>
            ))}
            {writers.map((w: any) => (
              <div
                key={w.id}
                onClick={() => setSelectedPersonId(w.id)}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                <p className="font-extrabold text-sm">{w.name}</p>
                <p className="opacity-60">{t('writer')}</p>
              </div>
            ))}
          </div>
        )}

        {/* Recommendations / Рекомендуем также (Only on initial card before pressing Watch) */}
        {!isExtracting && !iframeUrl && recommendations.length > 0 && (
          <div className="relative border-t border-white/10 pt-4 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-xl">{t('recommendations')}</h2>
              {WebApp.platform === 'unknown' && (
                <div className="flex gap-2">
                  <button 
                    onClick={() => scrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
                    className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                  </button>
                  <button 
                    onClick={() => scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
                    className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  </button>
                </div>
              )}
            </div>
            <div ref={scrollRef} className="flex overflow-x-auto gap-4 pt-1 pb-6 snap-x scrollbar-thin">
              {recommendations.map((rec) => (
                <div 
                  key={rec.id} 
                  className="min-w-[140px] w-[140px] sm:min-w-[150px] sm:w-[150px] snap-start cursor-pointer active:scale-95 transition-transform group card-hover rounded-xl relative z-10" 
                  onClick={() => {
                    setIframeUrl(null);
                    setSources([]);
                    navigate(`/movie/${rec.id}?type=${rec.type || 'movie'}`);
                  }}
                >
                  <div className="relative overflow-hidden rounded-xl w-full aspect-[2/3] shadow-sm bg-[var(--hint-color)]">
                    <img 
                      src={rec.poster} 
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 will-change-transform" 
                      alt={rec.title}
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  </div>
                  <p className="text-xs sm:text-sm mt-2 font-semibold truncate px-1 pb-1">{rec.title}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div id="video-player-container" className="relative">
          {showTooltip && WebApp.platform !== 'unknown' && (
            <div className="w-full bg-red-500/10 text-red-400 text-xs text-center py-2 px-4 font-medium rounded-lg mb-2 flex justify-center items-center border border-red-500/20">
              <span className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                {t('cancelPrompt')}
              </span>
            </div>
          )}
          {language !== 'ru-RU' && sources.length > 1 && !isExtracting && iframeUrl && (
            <div className="flex flex-wrap justify-center items-center gap-2 mb-3">
              {sources.map((src, idx) => (
                <button
                  key={src.url}
                  onClick={() => {
                    userSelectedRef.current = true;
                    setIframeUrl(src.url);
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all duration-200 shadow-sm cursor-pointer flex items-center gap-1.5 ${
                    iframeUrl === src.url 
                      ? 'bg-[var(--button-color)] text-white shadow-md scale-105 ring-2 ring-blue-400/30' 
                      : 'bg-[var(--hint-color)] text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {idx === 0 ? (t('player1') || 'Плеер 1') : (t('player2') || 'Плеер 2')}
                </button>
              ))}
            </div>
          )}
          {(isExtracting || iframeUrl) && (
            <div id="video-player" className="relative w-full md:w-[80%] mx-auto aspect-video rounded-lg overflow-hidden bg-black mt-2 shadow-xl mb-8 flex items-center justify-center">
            {isExtracting ? (
              <div className="flex flex-col items-center justify-center text-white/70 w-full px-8">
                <div className="w-full max-w-[200px] h-1.5 bg-gray-800 rounded-full overflow-hidden mb-4 shadow-inner">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                    style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
                  />
                </div>
                <p className="text-blue-400 text-xs font-bold tracking-wider uppercase animate-pulse">{t('loading')} {Math.round(loadingProgress)}%</p>
              </div>
            ) : iframeUrl ? (
              <div className="w-full h-full flex flex-col relative group">
                <div className="flex-1 w-full h-full">
                  <Player 
                    iframeUrl={iframeUrl} 
                    initialTimecode={savedTimecode || undefined} 
                    mediaId={id} 
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
        </div>

        {/* TV Series Seasons and Episodes UI (Only in Watch Mode) */}
        {(isExtracting || iframeUrl) && mediaType === 'tv' && (
          <div className="mb-8">
            <h3 className="font-bold text-lg mb-3">{t('seasonsAndEpisodes') || 'Сезоны и серии'}</h3>
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <div className="flex-1 relative">
                <select
                  value={activeSeason || sortedSeasons[0] || '1'}
                  onChange={(e) => {
                    const season = e.target.value;
                    const availableEpisodes = Array.isArray(liftwEpisodes?.[season]) ? liftwEpisodes[season] : ['1'];
                    const sortedAvail = availableEpisodes.slice().sort((a: any, b: any) => {
                      const numA = parseInt(String(a), 10);
                      const numB = parseInt(String(b), 10);
                      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
                    });
                    const defaultEpisode = sortedAvail[0] || '1';
                    handleSeasonEpisodeChange(season, defaultEpisode);
                  }}
                  className="w-full px-4 py-3 rounded-xl appearance-none outline-none font-bold shadow-sm cursor-pointer border border-transparent focus:border-[var(--button-color)] transition-all"
                  style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                >
                  {sortedSeasons.map((season: string) => (
                    <option key={season} value={season} className="bg-[var(--bg-color)] text-[var(--text-color)]">
                      {t('season')} {season}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-50">▼</div>
              </div>

              <div className="flex-1 relative">
                <select
                  value={activeEpisode || sortedEpisodes[0] || '1'}
                  onChange={(e) => handleSeasonEpisodeChange(activeSeason || sortedSeasons[0] || '1', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl appearance-none outline-none font-bold shadow-sm cursor-pointer border border-transparent focus:border-[var(--button-color)] transition-all"
                  style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                >
                  {sortedEpisodes.map((episode: string) => (
                    <option key={episode} value={episode} className="bg-[var(--bg-color)] text-[var(--text-color)]">
                      {t('episode')} {episode}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-50">▼</div>
              </div>
            </div>
          </div>
        )}

        {/* Cast Carousel / В главных ролях (Under player in Watch mode) */}
        {(isExtracting || iframeUrl) && cast.length > 0 && (
          <div className="mb-8 border-t border-white/10 pt-4 space-y-3">
            <h3 className="font-extrabold text-base">{t('topCast')}</h3>
            <div className="flex overflow-x-auto gap-3 pt-1 pb-6 scrollbar-thin">
              {cast.map((actor: any) => (
                <div
                  key={actor.id}
                  onClick={() => setSelectedPersonId(actor.id)}
                  className="w-24 min-w-[96px] cursor-pointer group space-y-1 text-center"
                >
                  <img
                    src={actor.profile_path ? getTmdbImageUrl(actor.profile_path, 'w185') : 'https://placehold.co/185x278/242f3d/ffffff?text=No+Photo'}
                    alt={actor.name}
                    className="w-24 aspect-[2/3] object-cover rounded-xl shadow group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                  <p className="text-xs font-bold truncate group-hover:text-blue-400 transition-colors pb-0.5">
                    {actor.name}
                  </p>
                  <p className="text-[10px] opacity-60 truncate pb-0.5">
                    {actor.character}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Banner */}
        <div className="mt-8 mb-4">
          <ExoClickMainBanner />
        </div>
      </div>

      {/* Trailer Modal */}
      {showTrailerModal && trailerVideo && (
        <TrailerModal
          videoKey={trailerVideo.key}
          title={movie?.title || ''}
          onClose={() => setShowTrailerModal(false)}
        />
      )}

      {/* Person Details Modal */}
      {selectedPersonId && (
        <PersonModal
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
          fetchPersonDetails={fetchPersonDetails}
        />
      )}
    </div>
  );
}
