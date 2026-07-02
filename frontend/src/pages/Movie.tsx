import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ReactPlayer from 'react-player';
import { WebApp } from '../telegram';
import { useApi } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';
import { Player } from '../components/Player';
import { useAdManager } from '../context/AdManager';

export const BACKEND_URL = import.meta.env.PROD 
  ? "https://evro90-nm6.hf.space" 
  : "http://localhost:7860";

export function Movie() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchMovieDetails, fetchRecommendations, loading } = useApi();
  const { t, language } = useLanguage();
  const { triggerMovieAd, triggerPostAd } = useAdManager();
  
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [sources, setSources] = useState<{name: string, url: string}[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [movie, setMovie] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
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

  // Configure Telegram BackButton
  useEffect(() => {
    WebApp.BackButton.show();
    const backHandler = () => {
      triggerPostAd();
      navigate(-1);
    };
    WebApp.BackButton.onClick(backHandler);
    return () => {
      WebApp.BackButton.offClick(backHandler);
      WebApp.BackButton.hide();
    };
  }, [navigate, triggerPostAd]);

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
        
        const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
        setIsFavorite(favs.some((f: any) => f.id === details.id));

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
  }, [id]); // re-trigger when movie id changes

  const handleWatch = async () => {
    if (!movie) return;
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

      const queryParams: Record<string, string> = {
        title: (movie as any).title || (movie as any).name || '',
        year: (movie as any).year || '',
        type: mediaType,
        tmdb: (movie as any).id?.toString() || '',
        imdb: (movie as any).imdb_id || ''
      };
      
      const query = new URLSearchParams(queryParams);
      query.append('_t', Date.now().toString());
      
      const res = await fetch(`${BACKEND_URL}/api/stream?${query.toString()}`);
      const data = await res.json();
      
      if (data.url) {
        finalStreamUrl = data.url;
      } else if (data.iframe) {
        finalIframe = data.iframe;
      }
      
      if (data.sources && data.sources.length > 0) {
        setSources(data.sources);
        if (language === 'en-US' && data.sources.length > 1) {
          finalIframe = data.sources[1].url;
        }
      }

      if (finalStreamUrl) {
        setStreamUrl(finalStreamUrl);
      } else if (finalIframe) {
        setIframeUrl(finalIframe);
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

  const addToFavorites = () => {
    try {
      if (!movie) return;
      let favs = JSON.parse(localStorage.getItem('favorites') || '[]');
      if (!isFavorite) {
        favs.unshift({ id: movie.id, title: movie.title, type: mediaType, poster: movie.poster });
        localStorage.setItem('favorites', JSON.stringify(favs));
        setIsFavorite(true);
        WebApp.HapticFeedback.notificationOccurred('success');
      } else {
        favs = favs.filter((f: any) => f.id !== movie.id);
        localStorage.setItem('favorites', JSON.stringify(favs));
        setIsFavorite(false);
        WebApp.HapticFeedback.notificationOccurred('warning');
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading && !movie) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('loading')}</div>;
  }

  if (!movie) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('movieNotFound')}</div>;
  }



  return (
    <div className="pb-20">
      <div className="relative">
        {WebApp.platform === 'unknown' && (
          <button 
            onClick={() => navigate(-1)}
            className="absolute top-4 left-4 z-50 p-2 bg-black/50 backdrop-blur-md rounded-full shadow-md text-white hover:scale-110 transition-transform"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
        )}
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
            <button 
              onClick={addToFavorites}
              style={{ 
                backgroundColor: isFavorite ? 'var(--button-color)' : 'var(--hint-color)', 
                color: isFavorite ? 'var(--button-text-color)' : 'var(--button-color)' 
              }}
              className="p-3 rounded-full shadow-lg active:scale-95 transition-transform flex-shrink-0"
            >
              ★
            </button>

            {showShareMenu && (
              <div 
                className="absolute top-14 right-0 shadow-2xl rounded-xl p-3 w-52 flex flex-col gap-2 border"
                style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--hint-color)' }}
              >
                <button
                  onClick={() => {
                    setShowShareMenu(false);
                    const tgLink = `https://t.me/mediaboxxxbot/app?startapp=${mediaType}_${movie?.id}`;
                    const text = `Watch "${movie?.title}" for free on MovieManiak!`;
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
                    const webLink = `https://moviemaniak5555.xyz/movie/${movie?.id}?type=${mediaType}`;
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
              className="w-full py-4 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg"
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
              <div className="flex flex-col items-center justify-center text-white/70">
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="font-medium text-sm">{t('loading')}</p>
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
            {sources.map((s, idx) => (
              <button 
                key={idx} 
                onClick={() => setIframeUrl(s.url)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border`} style={{ backgroundColor: iframeUrl === s.url ? 'var(--button-color)' : 'var(--hint-color)', color: iframeUrl === s.url ? 'var(--button-text-color)' : 'var(--text-color)', borderColor: iframeUrl === s.url ? 'var(--button-color)' : 'var(--hint-color)' }}
              >
                {idx === 0 ? t('player1') : t('player2')}
              </button>
            ))}
          </div>
        )}

        {recommendations.length > 0 && (
          <>
          <div className="relative group">
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
            <div ref={scrollRef} className="flex overflow-x-auto gap-4 pb-4 snap-x" style={{ scrollbarWidth: 'none' }}>
              {recommendations.map((rec) => (
                <div 
                  key={rec.id} 
                  className="min-w-[130px] w-[130px] snap-start cursor-pointer active:scale-95 transition-transform" 
                  onClick={() => {
                    setStreamUrl(null);
                    setIframeUrl(null);
                    setSources([]);
                    navigate(`/movie/${rec.id}?type=${rec.type || 'movie'}`);
                  }}
                >
                  <img 
                    src={rec.poster} 
                    className="rounded-xl w-full aspect-[2/3] object-cover shadow-sm" 
                    alt={rec.title}
                  />
                  <p className="text-sm mt-2 font-semibold truncate">{rec.title}</p>
                </div>
              ))}
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
