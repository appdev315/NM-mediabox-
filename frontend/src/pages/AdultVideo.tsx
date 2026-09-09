import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Player } from '../components/Player';
import { Header } from '../components/Header';
import { useLanguage } from '../context/LanguageContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { AdsterraBanner300x250 } from '../components/AdsterraBanner300x250';
import { BannerAd } from '../components/BannerAd';
import { trackOpen } from '../utils/analytics';

export function AdultVideo() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { stop: stopAudio } = useAudioPlayer();
  const { fetchAdultStream, fetchAdultSearch } = useApi();
  
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<any>(null);
  const [relatedVideos, setRelatedVideos] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    let isCurrent = true;

    const fetchVideoAndRelated = async () => {
      setLoading(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      try {
        // Fetch Video Details using cached API helper
        const data = await fetchAdultStream(id);
        if (!isCurrent) return;

        if (data) {
          stopAudio();
          setDetails(data);
          trackOpen('adult', data.title || 'Video', String(data.id || id));

          // Save to adult history
          try {
            let hist = JSON.parse(localStorage.getItem('history_adult') || '[]');
            hist = hist.filter((item: any) => item.id !== data.id);
            hist.unshift({
              id: data.id,
              title: data.title || 'Video',
              poster: data.poster || '',
              duration: data.duration || '',
              type: 'adult'
            });
            if (hist.length > 30) hist = hist.slice(0, 30);
            localStorage.setItem('history_adult', JSON.stringify(hist));
          } catch (e) {
            console.error(e);
          }
        }

        // Fetch Related Videos using cached API helper
        let cat = location.state?.category || 'teen';
        if (cat === '') cat = 'milf'; // fallback if empty
        const relatedData = await fetchAdultSearch(cat, 0);
        if (!isCurrent) return;
        
        if (Array.isArray(relatedData)) {
          // Shuffle and take up to 20
          const shuffled = [...relatedData].sort(() => 0.5 - Math.random());
          setRelatedVideos(shuffled.slice(0, 20));
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    };
    fetchVideoAndRelated();

    return () => {
      isCurrent = false;
    };
  }, [id, location.state, fetchAdultStream, fetchAdultSearch]);

  if (loading) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('loadingVideo')}</div>;
  }

  if (!details || (!details.iframe && !details.mp4)) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">{t('videoNotFound')}</div>;
  }

  return (
    <div className="pb-20">
      <div className="p-4 pt-20 sm:pt-24">
        {/* Top Banner to Telegram Bot */}
        <div className="mb-4">
          <BannerAd variant="wide" type="telegram" />
        </div>

        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-bold">{t('privateCollection')} 🍓</h1>
        </div>
        
        <div id="video-player-container">

          <div className="relative w-full md:w-[80%] mx-auto aspect-video rounded-lg overflow-hidden bg-black shadow-xl mb-8 flex items-center justify-center">
            {details.mp4 ? (
              <video
                src={details.mp4}
                className="w-full h-full object-contain"
                controls
                autoPlay
                playsInline
              />
            ) : details.iframe ? (
              <Player iframeUrl={details.iframe} mirrors={details.mirrors} />
            ) : null}
          </div>
        </div>
        
        <p className="text-sm opacity-70 leading-relaxed mb-4">
          {t('securePlaybackNotice')}
        </p>
        
        <div className="mb-8">
          <AdsterraBanner300x250 />
        </div>

        {/* Related Videos */}
        {relatedVideos.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold mb-4">{t('recommendations')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 w-full">
              {relatedVideos.map((v) => {
                if (v.id === id) return null; // Skip current video
                return (
                  <React.Fragment key={v.id}>
                    <div 
                      className="cursor-pointer"
                      onClick={() => navigate(`/adult/${v.id}`, { state: location.state })}
                    >
                      <div className="aspect-[4/3] rounded-xl overflow-hidden mb-1.5 relative bg-[var(--hint-color)]">
                        <img 
                          src={v.poster} 
                          className="w-full h-full object-cover" 
                          alt="" 
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            const img = e.currentTarget;
                            const src = img.src;
                            if (src.includes('thumb-cdn77.xvideos-cdn.com')) {
                              img.src = src.replace('thumb-cdn77.xvideos-cdn.com', 'thumbs-gcore.xvideos-cdn.com');
                            } else if (src.includes('thumbs-gcore.xvideos-cdn.com')) {
                              img.src = src.replace('thumbs-gcore.xvideos-cdn.com', 'static-ss.xvideos-cdn.com');
                            } else {
                              img.onerror = null;
                              img.src = 'https://placehold.co/400x300/242f3d/ffffff?text=No+Preview';
                            }
                          }}
                        />
                        <div className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                          {v.duration}
                        </div>
                      </div>
                      <p className="text-sm font-semibold line-clamp-2 leading-snug break-words">{v.title}</p>
                    </div>
                  </React.Fragment>
                );
              })}

              {/* Return to Category / Previous Page Card */}
              <div 
                className="cursor-pointer group flex flex-col"
                onClick={() => {
                  if (window.history.length > 1) {
                    navigate(-1);
                  } else {
                    navigate('/adult', { state: location.state });
                  }
                }}
              >
                <div className="aspect-[4/3] rounded-xl overflow-hidden mb-1.5 relative bg-gradient-to-br from-zinc-950 via-[#18101a] to-black border border-pink-500/30 group-hover:border-pink-500/80 shadow-lg flex flex-col items-center justify-center transition-all duration-200 active:scale-95">
                  {/* Adult-themed kiss background */}
                  <img 
                    src="/kiss-bg.png" 
                    alt="" 
                    className="absolute inset-0 w-full h-full object-cover opacity-35 group-hover:opacity-50 transition-opacity duration-300 pointer-events-none select-none" 
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/35 pointer-events-none" />

                  {/* Volumetric 3D return symbol */}
                  <div className="relative z-10 flex flex-col items-center justify-center">
                    <div className="relative flex items-center justify-center transition-transform duration-200 group-hover:scale-110 active:scale-90">
                      <span 
                        className="text-4xl sm:text-5xl select-none leading-none inline-block filter drop-shadow-[0_4px_10px_rgba(0,0,0,0.9)]"
                        style={{ textShadow: '0 1px 0 #ffffff, 0 2px 0 #f472b6, 0 3px 0 #db2777, 0 4px 0 #9d174d, 0 6px 10px rgba(0,0,0,0.85)' }}
                      >
                        ↩️
                      </span>
                    </div>
                    <span className="mt-2 text-xs sm:text-sm font-black text-white tracking-wide uppercase px-2 text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] line-clamp-1">
                      {location.state?.category ? `«${location.state.category}»` : t('backToCatalog')}
                    </span>
                  </div>

                  {/* Top-Right Badge: Adult Theme */}
                  <div className="absolute top-1.5 right-1.5 bg-pink-950/85 border border-pink-500/50 text-pink-300 text-[9px] font-black px-1.5 py-0.5 rounded shadow z-10 select-none">
                    🍓 18+
                  </div>

                  {/* Bottom-Right Badge: Back Label */}
                  <div className="absolute bottom-1.5 right-1.5 bg-black/85 border border-white/10 text-pink-400 text-[10px] font-bold px-1.5 py-0.5 rounded-md z-10">
                    {t('back')}
                  </div>
                </div>

                <p className="text-sm font-semibold line-clamp-2 leading-snug break-words text-pink-400/90 group-hover:text-pink-300 transition-colors">
                  {t('returnToList')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
      <Header />
    </div>
  );
}
