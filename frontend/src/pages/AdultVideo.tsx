import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';
import { BACKEND_URL } from './Movie';
import ReactPlayer from 'react-player';
import { Player } from '../components/Player';

export function AdultVideo() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<any>(null);

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
    if (!id) return;
    const fetchVideo = async () => {
      setLoading(true);
      try {
        const initData = WebApp?.initData || '';
        const headers = { 'Authorization': `tma ${initData}` };
        const res = await fetch(`${BACKEND_URL}/api/adult/stream?id=${encodeURIComponent(id)}`, { headers });
        const data = await res.json();
        setDetails(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchVideo();
  }, [id]);

  if (loading) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">Loading video...</div>;
  }

  if (!details || (!details.iframe && !details.mp4)) {
    return <div className="p-8 pb-20 text-center font-medium opacity-50 mt-10">Video not found or removed</div>;
  }

  return (
    <div className="pb-20">
      <div className="relative">
      </div>


      <div className="p-4 pt-16">
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
        
        <p className="text-sm opacity-70 leading-relaxed">
          This content is provided securely. Remember that screen recording might be blocked by your device for protected content.
        </p>
      </div>
    </div>
  );
}
