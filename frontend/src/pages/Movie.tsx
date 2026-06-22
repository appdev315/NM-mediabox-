import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useApi } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';

export function Movie() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchMovieDetails, fetchSeasonDetails, fetchRecommendations, loading } = useApi();
  const { t, language } = useLanguage();
  
  const [isShieldActive, setIsShieldActive] = useState(true);
  const [playerIdx, setPlayerIdx] = useState(0);
  const [movie, setMovie] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  // TV specific states
  const [selectedSeason, setSelectedSeason] = useState<number | ''>('');
  const [selectedEpisode, setSelectedEpisode] = useState<number | ''>('');
  const [episodesList, setEpisodesList] = useState<any[]>([]);

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
      setIsShieldActive(true);
      
      try {
        const details = await fetchMovieDetails(id, mediaType);
        setMovie(details);

        if (mediaType === 'tv' && details.seasons?.length > 0) {
          const validSeason = details.seasons.find((s: any) => s.season_number > 0) || details.seasons[0];
          if (validSeason) setSelectedSeason(validSeason.season_number);
        }

        const recs = await fetchRecommendations(id, mediaType);
        setRecommendations(recs);
      } catch (err) {
        console.error("Failed to load movie data", err);
      }
    };
    loadData();
    window.scrollTo(0, 0);
  }, [id, mediaType, fetchMovieDetails, fetchRecommendations]);

  // Load episodes when season changes
  useEffect(() => {
    if (mediaType === 'tv' && selectedSeason !== '') {
      const loadEpisodes = async () => {
        const data = await fetchSeasonDetails(id as string, Number(selectedSeason));
        if (data && data.episodes) {
          setEpisodesList(data.episodes);
          setSelectedEpisode(data.episodes[0]?.episode_number || '');
        }
      };
      loadEpisodes();
    }
  }, [selectedSeason, id, mediaType, fetchSeasonDetails]);

  const handleWatch = () => {
    setIsShieldActive(false);
    document.getElementById('video-player')?.scrollIntoView({ behavior: 'smooth' });
  };

  const addToFavorites = () => {
    WebApp.HapticFeedback.notificationOccurred('success');
  };

  if (loading && !movie) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('loading')}</div>;
  }

  if (!movie) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('movieNotFound')}</div>;
  }

  const servers = [
    { name: "Server 1", url: (type: string, id: string) => `https://vidsrc.pro/embed/${type === 'tv' ? 'tv' : 'movie'}/${id}${type === 'tv' ? `/${selectedSeason}/${selectedEpisode}` : ''}` },
    { name: "Server 2", url: (_type: string, id: string) => `https://multiembed.mov/?video_id=${id}&tmdb=1` },
    { name: "Server 3", url: (type: string, id: string) => `https://autoembed.to/${type === 'tv' ? 'tv' : 'movie'}/tmdb/${id}` }
  ];

  const iframeUrl = servers[playerIdx].url(mediaType, id as string);

  return (
    <div className="pb-20">
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
          <h1 className="text-3xl font-extrabold leading-tight shadow-sm drop-shadow-sm">{movie.title}</h1>
          <button 
            onClick={addToFavorites}
            style={{ backgroundColor: 'var(--hint-color)', color: 'var(--button-color)' }}
            className="p-3 rounded-full shadow-lg ml-4 active:scale-95 transition-transform flex-shrink-0"
          >
            ★
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-sm opacity-70 mb-6 font-medium drop-shadow-sm">
          {movie.year && <span>{movie.year}</span>}
          {movie.year && movie.country && <span>•</span>}
          {movie.country && <span>{movie.country}</span>}
          {movie.country && movie.genre && <span>•</span>}
          {movie.genre && <span>{movie.genre}</span>}
        </div>

        <div className="flex flex-col gap-4 mb-6">
          {mediaType === 'tv' && movie.seasons?.length > 0 && (
            <div className="flex gap-4">
              <select 
                className="flex-1 p-3 rounded-xl outline-none text-sm border-none shadow-sm"
                style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(Number(e.target.value))}
              >
                <option value="" disabled>Сезон</option>
                {movie.seasons.filter((s: any) => s.season_number > 0).map((s: any) => (
                  <option key={s.id} value={s.season_number}>Сезон {s.season_number}</option>
                ))}
              </select>

              <select 
                className="flex-1 p-3 rounded-xl outline-none text-sm border-none shadow-sm"
                style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                value={selectedEpisode}
                onChange={(e) => setSelectedEpisode(Number(e.target.value))}
                disabled={episodesList.length === 0}
              >
                <option value="" disabled>Серия</option>
                {episodesList.map((ep: any) => (
                  <option key={ep.id} value={ep.episode_number}>{ep.episode_number} серия</option>
                ))}
              </select>
            </div>
          )}
          
          <button
            onClick={handleWatch}
            className="w-full py-4 rounded-2xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-lg"
            style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
          >
            ▶ {t('watch')}
          </button>
        </div>

        <p className="text-[15px] opacity-80 mb-8 leading-relaxed font-medium">
          {movie.description || t('descriptionMissing')}
        </p>

        <div id="video-player" className="relative w-full aspect-video rounded-lg overflow-hidden bg-black mt-6 shadow-xl mb-8">
          <iframe 
            src={iframeUrl} 
            className="absolute inset-0 w-full h-full border-none z-0" 
            allowFullScreen 
            allow="autoplay; fullscreen"
          />
          
          {isShieldActive && (
            <div 
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-cover bg-center cursor-pointer group" 
              style={{ backgroundImage: `url(${movie?.poster})` }}
              onClick={() => setIsShieldActive(false)}
            >
              <div className="absolute inset-0 bg-black/60 transition-opacity group-hover:bg-black/40" />
              <div className="relative z-20 w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center shadow-lg transition-transform group-hover:scale-110">
                <svg className="w-10 h-10 text-white ml-2" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"/></svg>
              </div>
              <span className="relative z-20 mt-4 text-white font-medium text-lg drop-shadow-md">
                {language === 'ru-RU' ? 'Смотреть' : 'Watch Now'}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-2 mb-8 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
          {servers.map((s, i) => (
            <button 
              key={i} 
              onClick={() => {
                setPlayerIdx(i);
                setIsShieldActive(false); // Отключаем щит при смене сервера, чтобы сразу проверить
              }} 
              className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-transform active:scale-95 ${playerIdx === i ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-800 text-gray-300'}`}
            >
              {s.name}
            </button>
          ))}
        </div>

        {recommendations.length > 0 && (
          <>
            <h2 className="font-bold text-xl mb-4">{t('recommendations')}</h2>
            <div className="flex overflow-x-auto gap-4 pb-4 snap-x" style={{ scrollbarWidth: 'none' }}>
              {recommendations.map((rec) => (
                <div 
                  key={rec.id} 
                  className="min-w-[130px] w-[130px] snap-start cursor-pointer active:scale-95 transition-transform" 
                  onClick={() => {
                    setIsShieldActive(true);
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
