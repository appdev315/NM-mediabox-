import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ReactPlayer from 'react-player';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { Player } from '../components/Player';
import { useAdManager } from '../context/AdManager';
import { ExoClickMainBanner } from '../components/ExoClickMainBanner';
import { useApi, EXPRESS_API_BASE } from '../hooks/useApi';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { usePlaybackResilience } from '../hooks/usePlaybackResilience';
import { TrailerModal } from '../components/TrailerModal';
import { PersonModal } from '../components/PersonModal';
import { useViewportExpand } from '../hooks/useViewportExpand';

export function Movie() {
  const { id } = useParams();
  useViewportExpand([id]);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchMovieDetails, fetchPersonDetails, fetchRecommendations, loading } = useApi();
  const { t, language } = useLanguage();
  const { triggerMovieAd } = useAdManager();
  const { savedTimecode } = usePlaybackResilience({ mediaId: id });
  
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [sources, setSources] = useState<{name: string, url: string, isLiftw?: boolean}[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [movie, setMovie] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
  const [liftwEpisodes, setLiftwEpisodes] = useState<any>(null);
  const [activeSeason, setActiveSeason] = useState<string>('');
  const [activeEpisode, setActiveEpisode] = useState<string>('');
  const [showTrailerModal, setShowTrailerModal] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<number | string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userSelectedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPrimaryReady, setIsPrimaryReady] = useState(false);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (autoFallbackTimerRef.current) {
        clearTimeout(autoFallbackTimerRef.current);
      }
    };
  }, []);

  // Reset ready state on source change
  useEffect(() => {
    setIsPrimaryReady(false);
  }, [iframeUrl]);

  // 6-Second Automatic Fallback from Primary Player (Liftw) to Secondary (Anwap / Global)
  // ONLY if primary player failed to report ready state within 6 seconds
  useEffect(() => {
    if (autoFallbackTimerRef.current) {
      clearTimeout(autoFallbackTimerRef.current);
      autoFallbackTimerRef.current = null;
    }

    if (sources.length > 1 && iframeUrl === sources[0]?.url && !isPrimaryReady) {
      autoFallbackTimerRef.current = setTimeout(() => {
        console.log('[PlayerFallback] 6s timeout reached without ready signal, auto switching to fallback player...');
        if (sources[1]?.url) {
          setIframeUrl(sources[1].url);
        }
      }, 6000);
    }

    return () => {
      if (autoFallbackTimerRef.current) {
        clearTimeout(autoFallbackTimerRef.current);
      }
    };
  }, [iframeUrl, sources, isPrimaryReady]);

  const handleSeasonEpisodeChange = (season: string, episode: string) => {
    setActiveSeason(season);
    setActiveEpisode(episode);

    const currentSource = sources.find((s: any) => s.url === iframeUrl);
    if (currentSource?.isLiftw) {
      const iframe = document.getElementById('video-iframe') as HTMLIFrameElement;
      if (iframe && iframe.contentWindow) {
        const iframeOrigin = new URL(iframe.src).origin;
        iframe.contentWindow.postMessage({ event: 'playlist go', season: parseInt(season), episode: parseInt(episode) }, iframeOrigin);
      }
    } else {
      setIframeUrl(prev => {
        if (!prev) return prev;
        if (prev.includes('/embed/tv/')) {
          const parts = prev.split('/embed/tv/')[1]?.split('/') || [];
          const tmdbId = parts[0];
          const base = prev.split('/embed/tv/')[0];
          return `${base}/embed/tv/${tmdbId}/${season}/${episode}`;
        }
        return prev;
      });
    }
  };

  useEffect(() => {
    if (iframeUrl) {
      setShowTooltip(true);
      const timer = setTimeout(() => setShowTooltip(false), 15000);
      return () => clearTimeout(timer);
    }
  }, [iframeUrl]);
  
  // Validate media type
  const queryType = searchParams.get('type');
  const mediaType = queryType === 'series' || queryType === 'tv' ? 'tv' : 'movie';

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
      setStreamUrl(null);
      setIframeUrl(null);
      setSources([]);
      setIsExtracting(false);
      setMovie(null);
      userSelectedRef.current = false;
      try {
        const [details, recs] = await Promise.all([
          fetchMovieDetails(id, mediaType),
          fetchRecommendations(id, mediaType)
        ]);
        if (!isMounted) return;
        setMovie(details);
        setRecommendations(recs || []);
      } catch (err) {
        console.error("Failed to load movie data", err);
      }
    };
    
    loadData();
    window.scrollTo(0, 0);
    
    return () => {
      isMounted = false;
    };
  }, [id, mediaType, fetchMovieDetails, fetchRecommendations]);

  // Trigger ad when navigating to movie
  useEffect(() => {
    triggerMovieAd();
  }, [id, triggerMovieAd]); // re-trigger when movie id changes

  const handleWatch = async (forceRefresh = false) => {
    if (!movie) return;
    
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
    setStreamUrl(null);
    setIframeUrl(null);
    setSources([]);
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
      
      const query = new URLSearchParams(queryParams);
      query.append('_t', Date.now().toString());
      if (forceRefresh) {
        query.append('bypass_cache', 'true');
      }

      // Parallel fetch: existing Go stream + liftw.ws
      const liftwQuery = new URLSearchParams({
        title: queryParams.title,
        year: queryParams.year,
        type: queryParams.type,
        tmdb: queryParams.tmdb
      });
      if (forceRefresh) {
        liftwQuery.append('bypass_cache', 'true');
      }

      const foundSources: { liftw: any, go: any[], goIframe: any, goStream: any } = { 
        liftw: null, 
        go: [], 
        goIframe: null,
        goStream: null
      };

      let isLiftwDone = false;
      let isGoDone = false;

      const countryParam = (searchParams.get('country') || '').toUpperCase();
      const originCountries: string[] = movie?.origin_country || [];
      const isRu = language === 'ru-RU' || countryParam === 'RU' || countryParam === 'SU' || 
                         originCountries.includes('RU') || originCountries.includes('SU') || 
                         (movie?.country && /россия|ссср|russia/i.test(movie.country));

      const evaluateUIUnblock = () => {
        if (!isLiftwDone) return;
        if (foundSources.liftw || isGoDone) {
          setIsExtracting(false);
        }
      };

      const updateUI = () => {
        const combined: any[] = [];
        
        if (foundSources.liftw) {
          let liftwObj = { ...foundSources.liftw };
          if (!isRu) {
            const langCode = (language || 'en').split('-')[0] || 'en';
            if (!liftwObj.url.includes('lang=')) {
              liftwObj.url += (liftwObj.url.includes('?') ? '&' : '?') + `lang=${langCode}&audio=${langCode}&sound=${langCode}`;
            }
          }
          combined.push(liftwObj);

          if (foundSources.go.length > 0) {
            combined.push(foundSources.go[0]);
          } else if (foundSources.goIframe) {
            combined.push({ name: 'go', url: foundSources.goIframe, isLiftw: false });
          }
        } else if (isLiftwDone) {
          if (foundSources.go.length > 0) {
            combined.push(foundSources.go[0]);
          } else if (foundSources.goIframe) {
            combined.push({ name: 'go', url: foundSources.goIframe, isLiftw: false });
          }
        }

        // Cap to max 2 clean players (Player 1: Liftw, Player 2: Go/Anwap)
        if (combined.length > 2) {
          combined.length = 2;
        }

        const mapped = combined.map((s, i) => ({ ...s, name: `player${i + 1}` }));
        setSources(mapped);

        if (mapped.length > 0) {
          const preferredUrl = mapped[0].url;
          setIframeUrl(prev => prev || preferredUrl);
        }
      };

      // 2. Fetch liftw asynchronously
      const fetchLiftw = async () => {
        const start = performance.now();
        try {
          const res = await fetchWithRetry(`${EXPRESS_API_BASE}/liftw?${liftwQuery.toString()}`);
          if (!res.ok) return;
          const liftwData = await res.json();
          if (liftwData && liftwData.iframe) {
            foundSources.liftw = { name: 'liftw', url: liftwData.iframe, isLiftw: true };
            
            if (liftwData.episodes) {
              setLiftwEpisodes(liftwData.episodes);
              setActiveSeason(prevSeason => {
                if (prevSeason && liftwData.episodes[prevSeason]) return prevSeason;
                return Object.keys(liftwData.episodes)[0] || '1';
              });
              setActiveEpisode(prevEp => {
                if (prevEp) return prevEp;
                const firstSeason = Object.keys(liftwData.episodes)[0];
                return (firstSeason && liftwData.episodes[firstSeason]?.[0]) || '1';
              });
            }
          }
        } catch (e) {
          console.error("Liftw fetch failed", e);
        } finally {
          const end = performance.now();
          console.log(`[Perf] Liftw fetch completed in ${((end - start) / 1000).toFixed(2)}s`);
          isLiftwDone = true;
          updateUI();
          evaluateUIUnblock();
        }
      };

      // 3. Fetch Go stream asynchronously
      const fetchGo = async () => {
        const start = performance.now();
        let data: any = {};
        let attempts = 0;
        const maxAttempts = 2;
        
        try {
          while (attempts < maxAttempts) {
            try {
              query.set('_t', Date.now().toString());
              const res = await fetchWithRetry(`${EXPRESS_API_BASE}/stream?${query.toString()}`);
              data = await res.json();
              if (data.url || data.iframe || (data.sources && data.sources.length > 0)) break;
            } catch(e) {}
            attempts++;
            if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 1000));
          }

          if (data.url) {
            foundSources.goStream = data.url;
          } 
          if (data.iframe && language === 'ru-RU') {
            foundSources.goIframe = data.iframe;
          }
          if (data.sources && data.sources.length > 0) {
            foundSources.go = data.sources;
          }
        } finally {
          const end = performance.now();
          console.log(`[Perf] Go fetch completed in ${((end - start) / 1000).toFixed(2)}s`);
          isGoDone = true;
          updateUI();
          evaluateUIUnblock();
        }
      };

      // For RU content: strictly fetch Liftw FIRST. Only fallback to Go if Liftw does not have the title.
      if (isRu) {
        await fetchLiftw();
        if (!foundSources.liftw) {
          await fetchGo();
        }
      } else {
        await Promise.allSettled([fetchLiftw(), fetchGo()]);
      }

      const hasAnySource = foundSources.liftw || foundSources.go.length > 0 || foundSources.goIframe || streamUrl;
      if (!hasAnySource) {
         // No sources found at all
      }
    } catch (err) {
      console.error("Failed to extract stream", err);
      alert("Failed to load stream");
    } finally {
      setIsExtracting(false);
      setTimeout(() => {
        document.getElementById('video-player-container')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  };



  if (loading && !movie) {
    return (
      <div className="p-4 pt-20 pb-20 flex flex-col items-center justify-center min-h-[50vh]">
        <button 
          onClick={() => navigate(-1)} 
          className="self-start mb-6 px-4 py-2 rounded-xl bg-black/20 text-sm font-bold flex items-center gap-2"
        >
          ← {t('back') || 'Назад'}
        </button>
        <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium opacity-50">{t('loading')}</div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="p-4 pt-20 pb-20 flex flex-col items-center justify-center min-h-[50vh]">
        <button 
          onClick={() => navigate(-1)} 
          className="self-start mb-6 px-4 py-2 rounded-xl bg-black/20 text-sm font-bold flex items-center gap-2"
        >
          ← {t('back') || 'Назад'}
        </button>
        <div className="text-4xl mb-2">🎬</div>
        <div className="font-medium opacity-70 mb-4">{t('movieNotFound')}</div>
      </div>
    );
  }



  const formatRuntime = (minutes: number) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const trailerVideo = movie?.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') || movie?.videos?.results?.[0];
  const directors = movie?.credits?.crew?.filter((c: any) => c.job === 'Director') || [];
  const writers = movie?.credits?.crew?.filter((c: any) => c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Characters')?.slice(0, 3) || [];
  const cast = movie?.credits?.cast?.slice(0, 15) || [];
  const ratingPct = movie?.rating ? Math.round(movie.rating * 10) : 0;

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
              onClick={() => setShowTrailerModal(true)}
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

        {!(isExtracting || streamUrl || iframeUrl) && (
          <div className="flex flex-col gap-3 mb-6">
            <button
              onClick={() => handleWatch(false)}
              className="w-full py-4 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg"
              style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
            >
              ▶ {t('watch')}
            </button>
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
        {!(isExtracting || streamUrl || iframeUrl) && recommendations.length > 0 && (
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
                    setStreamUrl(null);
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
          {sources.length > 1 && !isExtracting && (iframeUrl || streamUrl) && (
            <div className="flex justify-center items-center gap-2 mb-3">
              {sources.map((src, idx) => (
                <button
                  key={src.url}
                  onClick={() => {
                    setStreamUrl(null);
                    setIframeUrl(src.url);
                  }}
                  className={`px-4 py-1.5 rounded-xl text-xs font-extrabold transition-all duration-200 shadow-sm cursor-pointer ${
                    iframeUrl === src.url 
                      ? 'bg-[var(--button-color)] text-white shadow-md scale-105 ring-2 ring-blue-400/30' 
                      : 'bg-[var(--hint-color)] text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {(t('player' as any) || 'Player')} {idx + 1}
                </button>
              ))}
            </div>
          )}
          {(isExtracting || streamUrl || iframeUrl) && (
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
                    onReady={() => setIsPrimaryReady(true)}
                  />
                </div>
              </div>
            ) : streamUrl ? (
              <ReactPlayer
                url={streamUrl}
                width="100%"
                height="100%"
                controls
                playsinline
                onError={() => {
                  console.log("ReactPlayer loading error, force-refreshing streams...");
                  handleWatch(true);
                }}
                // @ts-ignore
                config={{ file: { forceVideo: true, forceHLS: false, attributes: { playsInline: true, preload: 'metadata' } } }}
              />
            ) : null}
          </div>
        )}
        </div>

        {/* TV Series Seasons and Episodes UI (Only in Watch Mode) */}
        {(isExtracting || streamUrl || iframeUrl) && mediaType === 'tv' && (
          <div className="mb-8">
            <h3 className="font-bold text-lg mb-3">{t('seasonsAndEpisodes') || 'Сезоны и серии'}</h3>
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <div className="flex-1 relative">
                <select
                  value={activeSeason || '1'}
                  onChange={(e) => {
                    const season = e.target.value;
                    const availableEpisodes = liftwEpisodes && liftwEpisodes[season] ? liftwEpisodes[season] : ['1'];
                    const defaultEpisode = availableEpisodes[0] || '1';
                    handleSeasonEpisodeChange(season, defaultEpisode);
                  }}
                  className="w-full px-4 py-3 rounded-xl appearance-none outline-none font-bold shadow-sm cursor-pointer border border-transparent focus:border-[var(--button-color)] transition-all"
                  style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                >
                  {(liftwEpisodes ? Object.keys(liftwEpisodes).sort((a, b) => parseInt(a) - parseInt(b)) : (movie?.seasons ? movie.seasons.filter((s: any) => s.season_number > 0).map((s: any) => String(s.season_number)) : ['1', '2', '3', '4', '5'])).map((season: string) => (
                    <option key={season} value={season}>
                      {season} {t('season') || 'Сезон'}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-50">▼</div>
              </div>

              <div className="flex-1 relative">
                <select
                  value={activeEpisode || '1'}
                  onChange={(e) => {
                    const ep = e.target.value;
                    handleSeasonEpisodeChange(activeSeason || '1', ep);
                  }}
                  className="w-full px-4 py-3 rounded-xl appearance-none outline-none font-bold shadow-sm cursor-pointer border border-transparent focus:border-[var(--button-color)] transition-all"
                  style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                >
                  {(liftwEpisodes && activeSeason && liftwEpisodes[activeSeason] 
                    ? [...liftwEpisodes[activeSeason]].sort((a: string, b: string) => parseInt(a) - parseInt(b)) 
                    : Array.from({ length: 24 }, (_, i) => String(i + 1))
                  ).map((ep: string) => (
                    <option key={ep} value={ep}>
                      {(t('episode' as any) || 'Episode')} {ep}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-50">▼</div>
              </div>
            </div>
          </div>
        )}

        {/* Cast Carousel / В главных ролях (Under player in Watch mode) */}
        {(isExtracting || streamUrl || iframeUrl) && cast.length > 0 && (
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
                    src={actor.profile_path ? `https://image.tmdb.org/t/p/w185${actor.profile_path}` : 'https://placehold.co/185x278/242f3d/ffffff?text=No+Photo'}
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
