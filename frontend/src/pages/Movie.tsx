import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ReactPlayer from 'react-player';
import { WebApp } from '../telegram';
import { useApi } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';
import { Player } from '../components/Player';

export const BACKEND_URL = "https://evro90-nm3.hf.space";

export function Movie() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchMovieDetails, fetchRecommendations, loading } = useApi();
  const { t } = useLanguage();
  
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [movie, setMovie] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);

  // Validate media type
  const queryType = searchParams.get('type');
  const mediaType = queryType === 'series' || queryType === 'tv' ? 'tv' : 'movie';

  // Configure Telegram BackButton
  useEffect(() => {
    WebApp.BackButton.show();
    const backHandler = () => navigate(-1);
    WebApp.BackButton.onClick(backHandler);
    return () => WebApp.BackButton.hide();
  }, [navigate]);

  // Load movie/series details and recommendations
  useEffect(() => {
    if (!id) return;
    const loadData = async () => {
      setStreamUrl(null);
      setIframeUrl(null);
      setIsExtracting(false);
      
      try {
        const details = await fetchMovieDetails(id, mediaType);
        setMovie(details);
        
        const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
        setIsFavorite(favs.some((f: any) => f.id === details.id));

        const recs = await fetchRecommendations(id, mediaType);
        setRecommendations(recs);
      } catch (err) {
        console.error("Failed to load movie data", err);
      }
    };
    loadData();
    window.scrollTo(0, 0);
  }, [id, mediaType, fetchMovieDetails, fetchRecommendations]);

  const handleWatch = async () => {
    if (!movie) return;
    setIsExtracting(true);
    setStreamUrl(null);
    setIframeUrl(null);
    document.getElementById('video-player')?.scrollIntoView({ behavior: 'smooth' });

    try {
      let finalIframe = null;
      let finalStreamUrl = null;

      // Primary source: Our Anwap Playwright Backend (Russian dubbing)
      if (!finalIframe && !finalStreamUrl) {
        const queryParams: Record<string, string> = {
          title: movie.title || movie.name || '',
          year: movie.year || '',
          type: mediaType,
          tmdb: movie.id?.toString() || '',
          imdb: movie.imdb_id || ''
        };
        if (mediaType === 'tv') {
          // Defaults are handled by the backend
        }
        const query = new URLSearchParams(queryParams);
        // Add timestamp to bypass browser cache
      query.append('_t', Date.now().toString());
      const res = await fetch(`${BACKEND_URL}/api/stream?${query.toString()}`);
        const data = await res.json();
        
        if (data.url) {
          finalStreamUrl = data.url;
        } else if (data.iframe) {
          finalIframe = data.iframe;
        }
      }

      if (finalStreamUrl) {
        setStreamUrl(finalStreamUrl);
      } else if (finalIframe) {
        setIframeUrl(finalIframe);
      } else {
        alert(t('movieNotFound') || "Стрим не найден");
      }
    } catch (err) {
      console.error("Failed to extract stream", err);
      alert("Не удалось извлечь прямой поток");
    } finally {
      setIsExtracting(false);
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
        {/* MovieManiak Home Button */}
        <button 
          onClick={() => navigate('/')}
          className="absolute top-4 left-4 z-50 px-4 py-2 rounded-xl font-bold backdrop-blur-md shadow-lg active:scale-95 transition-transform flex items-center gap-2"
          style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-color)' }}
        >
          <span>←</span> MovieManiak
        </button>

        <img 
          src={movie.poster} 
          alt={movie.title} 
          className="w-full aspect-[2/3] max-h-[60vh] object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-color)] via-[var(--bg-color)]/20 to-transparent"></div>
      </div>

      <div className="-mt-16 relative z-10 p-4">
        <div className="flex justify-between items-start mb-2">
          <h1 className="text-3xl font-extrabold leading-tight shadow-sm drop-shadow-sm">{movie.title}</h1>
          <button 
            onClick={addToFavorites}
            style={{ 
              backgroundColor: isFavorite ? 'var(--button-color)' : 'var(--hint-color)', 
              color: isFavorite ? 'var(--button-text-color)' : 'var(--button-color)' 
            }}
            className="p-3 rounded-full shadow-lg ml-4 active:scale-95 transition-transform flex-shrink-0"
          >
            ★
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-sm opacity-100 mb-6 font-medium drop-shadow-sm">
          {movie.year && <span>{movie.year}</span>}
          {movie.year && movie.country && <span>•</span>}
          {movie.country && <span>{movie.country}</span>}
          {movie.country && movie.genre && <span>•</span>}
          {movie.genre && <span>{movie.genre}</span>}
        </div>

        <div className="flex flex-col gap-4 mb-6">
          
          <button
            onClick={handleWatch}
            className="w-full py-4 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg"
            style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
          >
            ▶ {t('watch')}
          </button>
        </div>

        <p className="text-[15px] opacity-100 mb-8 leading-relaxed font-medium">
          {movie.description || t('descriptionMissing')}
        </p>

        {(isExtracting || streamUrl || iframeUrl) && (
          <div id="video-player" className="relative w-full aspect-video rounded-lg overflow-hidden bg-black mt-6 shadow-xl mb-8 flex items-center justify-center">
            {isExtracting ? (
              <div className="flex flex-col items-center justify-center text-white/70">
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="font-medium text-sm">Searching for stream...</p>
              </div>
            ) : iframeUrl ? (
              <Player iframeUrl={iframeUrl} />
            ) : streamUrl ? (
              <ReactPlayer
                url={streamUrl}
                width="100%"
                height="100%"
                controls
                playing
                // @ts-ignore: 'file' is valid for ReactPlayer config but missing in local types
                config={{ file: { forceHLS: streamUrl.includes('.m3u8') } }}
              />
            ) : null}
          </div>
        )}

        {recommendations.length > 0 && (
          <>
            <h2 className="font-bold text-xl mb-4">{t('recommendations')}</h2>
            <div className="flex overflow-x-auto gap-4 pb-4 snap-x" style={{ scrollbarWidth: 'none' }}>
              {recommendations.map((rec) => (
                <div 
                  key={rec.id} 
                  className="min-w-[130px] w-[130px] snap-start cursor-pointer active:scale-95 transition-transform" 
                  onClick={() => {
                    setStreamUrl(null);
                    setIframeUrl(null);
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
          </>
        )}
      </div>
    </div>
  );
}
