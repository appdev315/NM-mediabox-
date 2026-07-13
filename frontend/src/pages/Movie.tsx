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

export function Movie() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchMovieDetails, fetchRecommendations, loading } = useApi();
  const { t, language } = useLanguage();
  const { triggerMovieAd } = useAdManager();
  
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
  const scrollRef = useRef<HTMLDivElement>(null);

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



  // Load movie/series details and recommendations
  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    
    const loadData = async () => {
      setStreamUrl(null);
      setIframeUrl(null);
      setSources([]);
      setIsExtracting(false);
      setMovie(null);
      try {
        const details = await fetchMovieDetails(id, mediaType);
        if (!isMounted) return;
        setMovie(details);
        
        const recs = await fetchRecommendations(id, mediaType);
        if (isMounted) setRecommendations(recs);
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

  const handleWatch = async () => {
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

    setIsExtracting(true);
    setStreamUrl(null);
    setIframeUrl(null);
    setSources([]);
    
    // Scroll to player placeholder immediately
    setTimeout(() => {
      document.getElementById('video-player-container')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      let finalIframe = null;
      let finalStreamUrl = null;
      const allSources: {name: string, url: string, isLiftw?: boolean}[] = [];

      const queryParams: Record<string, string> = {
        title: (movie as any).title || (movie as any).name || '',
        year: (movie as any).year || '',
        type: mediaType,
        tmdb: (movie as any).id?.toString() || '',
        imdb: (movie as any).imdb_id || ''
      };
      
      const query = new URLSearchParams(queryParams);
      query.append('_t', Date.now().toString());

      // Parallel fetch: existing Go stream + liftw.ws
      const liftwQuery = new URLSearchParams({
        title: queryParams.title,
        year: queryParams.year,
        type: queryParams.type,
        tmdb: queryParams.tmdb
      });

      const [goResult, liftwResult] = await Promise.allSettled([
        // Existing Go-based stream lookup (with retries)
        (async () => {
          let data: any = {};
          let attempts = 0;
          const maxAttempts = 3;
          while (attempts < maxAttempts) {
            query.set('_t', Date.now().toString());
            const res = await fetchWithRetry(`${EXPRESS_API_BASE}/stream?${query.toString()}`);
            data = await res.json();
            if (data.url || data.iframe || (data.sources && data.sources.length > 0)) break;
            attempts++;
            if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 1500));
          }
          return data;
        })(),
        // liftw.ws lookup
        (async () => {
          const res = await fetchWithRetry(`${EXPRESS_API_BASE}/liftw?${liftwQuery.toString()}`);
          if (!res.ok) return null;
          return await res.json();
        })().catch(() => null)
      ]);

      // 1. Process VidSrc for non-Russian users
      if (language !== 'ru-RU' && queryParams.tmdb) {
        const vidsrcUrl = mediaType === 'tv' 
          ? `https://vidsrc.net/embed/tv?tmdb=${queryParams.tmdb}`
          : `https://vidsrc.net/embed/movie?tmdb=${queryParams.tmdb}`;
        allSources.push({ name: 'vidsrc', url: vidsrcUrl, isLiftw: false });
      }

      // 2. Process liftw result
      const liftwData = liftwResult.status === 'fulfilled' ? liftwResult.value : null;
      if (liftwData && liftwData.iframe) {
        allSources.push({ name: 'liftw', url: liftwData.iframe, isLiftw: true });
        if (liftwData.episodes) {
          setLiftwEpisodes(liftwData.episodes);
          const firstSeason = Object.keys(liftwData.episodes)[0];
          if (firstSeason) {
            setActiveSeason(firstSeason);
            setActiveEpisode(liftwData.episodes[firstSeason][0]);
          }
        }
      }

      // 3. Process Go stream result
      const goData = goResult.status === 'fulfilled' ? goResult.value : {};
      if (goData.url) {
        finalStreamUrl = goData.url;
      } else if (goData.iframe && !liftwData?.iframe && (language === 'ru-RU')) {
        finalIframe = goData.iframe;
      }
      if (goData.sources && goData.sources.length > 0) {
        allSources.push(...goData.sources);
      }

      // 4. Ensure sequential player naming and set sources
      if (allSources.length > 0) {
        allSources.forEach((source, index) => {
          source.name = `player${index + 1}`;
        });
        setSources(allSources);
      }

      if (finalStreamUrl) {
        setStreamUrl(finalStreamUrl);
      } else if (finalIframe) {
        setIframeUrl(finalIframe);
      } else if (allSources.length > 0) {
        // If Go stream returned nothing but sources exist, use the first one
        setIframeUrl(allSources[0].url);
      } else {
        alert("Stream not found");
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
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('loading')}</div>;
  }

  if (!movie) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('movieNotFound')}</div>;
  }



  return (
    <div className="pb-20 animate-fade-in">
      <div className="relative">

        <img 
          src={movie.poster} 
          alt={movie.title} 
          className="w-full aspect-[2/3] max-h-[60vh] object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-color)] via-[var(--bg-color)]/20 to-transparent"></div>
      </div>

      <div className="-mt-16 relative z-10 p-4">
        <div className="flex justify-between items-start mb-2">
          <h1 className="text-3xl font-extrabold leading-tight shadow-sm drop-shadow-sm pr-2">{movie.title}</h1>
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

        <div className="flex flex-wrap gap-2 text-sm font-bold opacity-100 mb-2 drop-shadow-sm items-center">
          {movie.rating && movie.rating > 0 && <span className="flex items-center gap-1"><span className="text-yellow-400">⭐</span> {movie.rating.toFixed(1)}</span>}
          {movie.rating && movie.rating > 0 && (movie.imdb_id || movie.id) && <span className="opacity-50">•</span>}
          {(movie.imdb_id || movie.id) && <span className="bg-yellow-400 text-black px-1.5 py-0.5 rounded text-[10px] uppercase font-extrabold tracking-wider">IMDb</span>}
        </div>
        <div className="flex flex-wrap gap-2 text-sm opacity-100 mb-6 font-medium drop-shadow-sm">
          {movie.year && <span>{movie.year}</span>}
          {movie.year && movie.country && <span>•</span>}
          {movie.country && <span>{movie.country}</span>}
          {movie.country && movie.genre && <span>•</span>}
          {movie.genre && <span>{movie.genre}</span>}
        </div>

        {!(isExtracting || streamUrl || iframeUrl) && (
          <div className="flex flex-col gap-3 mb-6">
            <button
              onClick={handleWatch}
              className="w-full py-4 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg animate-pulse-glow"
              style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
            >
              ▶ {t('watch')}
            </button>
          </div>
        )}

        <p className="text-[15px] opacity-100 mb-8 leading-relaxed font-medium">
          {movie.description || t('descriptionMissing')}
        </p>

        <div id="video-player-container" className="relative">
          {showTooltip && WebApp.platform !== 'unknown' && (
            <div className="w-full bg-red-500/10 text-red-400 text-xs text-center py-2 px-4 font-medium rounded-lg mb-2 flex justify-center items-center border border-red-500/20">
              <span className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                {language === 'en-US' ? 'If a window asks to "Open Link", press "Cancel" to continue.' : 'Если появится запрос "Открыть ссылку", нажмите "Отмена".'}
              </span>
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
                  <Player iframeUrl={iframeUrl} />
                </div>
              </div>
            ) : streamUrl ? (
              <ReactPlayer
                url={streamUrl}
                width="100%"
                height="100%"
                controls
                playsinline
                // @ts-ignore
                config={{ file: { forceVideo: true, forceHLS: false } }}
              />
            ) : null}
          </div>
        )}
        </div>

        {/* Source selection buttons below the player */}
        {sources.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-8" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
            {sources.map((s: any) => {
              const labelIndex = s.isLiftw ? 1 : sources.filter((src: any) => !src.isLiftw).indexOf(s) + 2;
              const labelKey = labelIndex === 1 ? 'player1' : labelIndex === 2 ? 'player2' : 'player3';
              return (
                <button 
                  key={s.url} 
                  onClick={() => setIframeUrl(s.url)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border`} style={{ backgroundColor: iframeUrl === s.url ? 'var(--button-color)' : 'var(--hint-color)', color: iframeUrl === s.url ? 'var(--button-text-color)' : 'var(--text-color)', borderColor: iframeUrl === s.url ? 'var(--button-color)' : 'var(--hint-color)' }}
                >
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
        )}

        {/* Liftw Seasons and Episodes UI */}
        {liftwEpisodes && sources.find((s: any) => s.url === iframeUrl)?.isLiftw && (
          <div className="mb-8">
            <h3 className="font-bold text-lg mb-3">{t('seasonsAndEpisodes') || 'Сезоны и серии'}</h3>
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <div className="flex-1 relative">
                <select
                  value={activeSeason}
                  onChange={(e) => {
                    const season = e.target.value;
                    setActiveSeason(season);
                    setActiveEpisode(liftwEpisodes[season][0]);
                    const iframe = document.getElementById('video-iframe') as HTMLIFrameElement;
                    if (iframe && iframe.contentWindow) {
                      iframe.contentWindow.postMessage({ event: 'playlist go', season: parseInt(season), episode: liftwEpisodes[season][0] }, '*');
                    }
                  }}
                  className="w-full px-4 py-3 rounded-xl appearance-none outline-none font-bold shadow-sm cursor-pointer border border-transparent focus:border-[var(--button-color)] transition-all"
                  style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                >
                  {Object.keys(liftwEpisodes).sort((a, b) => parseInt(a) - parseInt(b)).map(season => (
                    <option key={season} value={season}>
                      {season} {t('season') || 'Сезон'}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-50">▼</div>
              </div>

              {activeSeason && liftwEpisodes[activeSeason] && (
                <div className="flex-1 relative">
                  <select
                    value={activeEpisode}
                    onChange={(e) => {
                      const ep = e.target.value;
                      setActiveEpisode(ep);
                      const iframe = document.getElementById('video-iframe') as HTMLIFrameElement;
                      if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage({ event: 'playlist go', season: parseInt(activeSeason), episode: ep }, '*');
                      }
                    }}
                    className="w-full px-4 py-3 rounded-xl appearance-none outline-none font-bold shadow-sm cursor-pointer border border-transparent focus:border-[var(--button-color)] transition-all"
                    style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                  >
                    {[...liftwEpisodes[activeSeason]].sort((a: string, b: string) => parseInt(a) - parseInt(b)).map((ep: string) => (
                      <option key={ep} value={ep}>
                        {ep} Серия
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none opacity-50">▼</div>
                </div>
              )}
            </div>
          </div>
        )}


        {recommendations.length > 0 && (
          <>
          <div className="relative">
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
            <div ref={scrollRef} className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-thin">
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
                  <p className="text-sm mt-2 font-semibold truncate px-1">{rec.title}</p>
                </div>
              ))}
            </div>
          </div>
          </>
        )}

        {/* Bottom Banner */}
        <div className="mt-8 mb-4">
          <ExoClickMainBanner />
        </div>
      </div>
    </div>
  );
}
