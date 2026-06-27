import { useState, useEffect } from 'react';
import { BACKEND_URL } from '../pages/Movie';

export function EpisodeSelector({ seasonUrl, onSelectEpisode }: { seasonUrl: string, onSelectEpisode: (ep: any) => void }) {
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHref, setSelectedHref] = useState('');

  useEffect(() => {
    if (!seasonUrl) return;
    let isMounted = true;
    const fetchEps = async () => {
      setLoading(true);
      try {
        const initData = window.Telegram?.WebApp?.initData || '';
        const headers = { 'Authorization': `tma ${initData}` };
        const res = await fetch(`${BACKEND_URL}/api/vip/download/link?url=${encodeURIComponent(seasonUrl)}`, { headers });
        const data = await res.json();
        if (!isMounted) return;
        if (data.type === 'season_episodes') {
          setEpisodes(data.items || []);
        }
      } catch(e) {
        console.error(e);
      } finally {
        if(isMounted) setLoading(false);
      }
    };
    fetchEps();
    return () => { isMounted = false; };
  }, [seasonUrl]);

  if (loading) return <div className="text-center opacity-50 py-2">Loading episodes...</div>;
  if (!episodes.length) return null;

  return (
    <select 
      className="w-full p-3 rounded-xl bg-[var(--hint-color)] text-[var(--text-color)] border-0 mt-3"
      onChange={(e) => {
        const ep = episodes.find(x => x.href === e.target.value);
        setSelectedHref(e.target.value);
        onSelectEpisode(ep);
      }}
      value={selectedHref}
    >
      <option value="">Select Episode</option>
      {episodes.map(ep => (
        <option key={ep.href} value={ep.href}>{ep.text}</option>
      ))}
    </select>
  );
}
