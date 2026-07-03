import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { WebApp } from '../telegram';
import { API_BASE } from '../hooks/useApi';
import ReactPlayer from 'react-player';
import { Player } from '../components/Player';
import { BannerAd } from '../components/BannerAd';
import { Header } from '../components/Header';
import { useLanguage } from '../context/LanguageContext';


export function AdultVideo() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<any>(null);
  const [relatedVideos, setRelatedVideos] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);

  useEffect(() => {
    WebApp.BackButton.show();
    const backHandler = () => navigate(-1);
    WebApp.BackButton.onClick(backHandler);
    return () => {
      WebApp.BackButton.hide();
      WebApp.BackButton.offClick(backHandler);
    };
  }, [navigate]);

  useEffect(() => {
    const savedFavs = localStorage.getItem('private_favs');
    if (savedFavs) {
      try { setFavorites(JSON.parse(savedFavs)); } catch(e){}
    }
  }, []);

  const toggleFavorite = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    setFavorites(prev => {
      const isFav = prev.some(f => f.id === item.id);
      const newFavs = isFav ? prev.filter(f => f.id !== item.id) : [...prev, item];
      localStorage.setItem('private_favs', JSON.stringify(newFavs));
      return newFavs;
    });
  };

  useEffect(() => {
    if (!id) return;
    const fetchVideoAndRelated = async () => {
      setLoading(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      try {
        const initData = WebApp?.initData || '';
        const headers = { 'Authorization': `tma ${initData}` };
        
        // Fetch Video Details
        const res = await fetch(`${API_BASE}/adult/stream?id=${encodeURIComponent(id)}`, { headers });
        const data = await res.json();
        setDetails(data);

        // Fetch Related Videos
        let cat = location.state?.category || 'teen';
        if (cat === '') cat = 'milf'; // fallback if empty
        const relatedRes = await fetch(`${API_BASE}/adult/search?q=${encodeURIComponent(cat)}&page=0`, { headers });
        const relatedData = await relatedRes.json();
        
        if (Array.isArray(relatedData)) {
          // Shuffle and take up to 20
          const shuffled = relatedData.sort(() => 0.5 - Math.random());
          setRelatedVideos(shuffled.slice(0, 20));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchVideoAndRelated();
  }, [id, location.state]);

  if (loading) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">Loading video...</div>;
  }

  if (!details || (!details.iframe && !details.mp4)) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">Video not found or removed</div>;
  }

  return (
    <div className="pb-20">
      <div className="p-4 pt-24">
        <div className="flex items-center gap-3 mb-6">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 bg-black/20 rounded-full shadow-md hover:scale-110 transition-transform"
            style={{ color: 'var(--text-color)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <h1 className="text-xl font-bold">Private Collection 🍓</h1>
        </div>
        
        <div id="video-player-container">

          <div className="relative w-full md:w-[80%] mx-auto aspect-video rounded-lg overflow-hidden bg-black shadow-xl mb-8 flex items-center justify-center">
            {details.mp4 ? (
              <ReactPlayer
                // @ts-ignore
                url={details.mp4}
                width="100%"
                height="100%"
                controls
                playing
              />
            ) : details.iframe ? (
              <Player iframeUrl={details.iframe} />
            ) : null}
          </div>
        </div>
        
        <p className="text-sm opacity-70 leading-relaxed mb-4">
          This content is provided securely. Remember that screen recording might be blocked by your device for protected content.
        </p>
        
        <div className="mb-8">

        </div>

        {/* Related Videos */}
        {relatedVideos.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold mb-4">{t('recommendations')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {relatedVideos.map((v, idx) => {
                if (v.id === id) return null; // Skip current video
                return (
                  <React.Fragment key={v.id}>
                    <div 
                      className="cursor-pointer active:scale-95 transition-transform"
                      onClick={() => navigate(`/adult/${v.id}`, { state: location.state })}
                    >
                      <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-2 relative shadow-sm">
                        <img src={v.poster} className="w-full h-full object-cover" alt="" />
                        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                          {v.duration}
                        </div>
                        <button 
                          onClick={(e) => toggleFavorite(e, v)}
                          className="absolute top-2 right-2 p-2 bg-black/50 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill={favorites.some(f => f.id === v.id) ? "#fbbf24" : "transparent"} stroke={favorites.some(f => f.id === v.id) ? "#fbbf24" : "white"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-sm font-semibold line-clamp-2 leading-snug">{v.title}</p>
                    </div>
                    {/* Insert Banner Ad after the 10th item */}
                    {idx === 9 && <BannerAd />}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <Header />
    </div>
  );
}
