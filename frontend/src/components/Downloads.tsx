import { useState, useEffect } from 'react';
import { WebApp } from '../telegram';
import { BACKEND_URL } from '../pages/Movie';
import { useLanguage } from '../context/LanguageContext';

export function Downloads() {
  const { language } = useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  // Modal states
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [downloadLinks, setDownloadLinks] = useState<any[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  useEffect(() => {
    const loadContent = async () => {
      setLoading(true);
      try {
        let res;
        if (searchQuery.trim().length > 0) {
          setIsSearching(true);
          const initData = WebApp?.initData || '';
          const headers = { 'Authorization': `tma ${initData}` };
          res = await fetch(`${BACKEND_URL}/api/vip/downloads/search?q=${encodeURIComponent(searchQuery)}&lang=${language}`, { headers });
        } else {
          setIsSearching(false);
          const initData = WebApp?.initData || '';
          const headers = { 'Authorization': `tma ${initData}` };
          res = await fetch(`${BACKEND_URL}/api/vip/downloads/latest?page=${page}&lang=${language}`, { headers });
        }
        
        const data = await res.json();
        const finalData = data;

        if (Array.isArray(finalData)) {
              if (page === 1) setItems(finalData);
              else setItems(prev => [...prev, ...finalData]);
        }
      } catch(e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(loadContent, 500);
    return () => clearTimeout(timeoutId);
  }, [page, searchQuery]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };
  
  const openDownloadModal = async (item: any) => {
    setSelectedItem(item);
    setDownloadLinks([]);
    setLoadingLinks(true);
    try {
      const initData = WebApp?.initData || '';
      const headers = { 'Authorization': `tma ${initData}` };
      const res = await fetch(`${BACKEND_URL}/api/vip/downloads/links?url=${item.id}`, { headers });
      const data = await res.json();
      setDownloadLinks(data.links || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLinks(false);
    }
  };

  const triggerDownload = (url: string) => {
    try {
      if (WebApp?.HapticFeedback) {
        WebApp.HapticFeedback.notificationOccurred('success');
      }
    } catch (e) {}

    const proxyUrl = `${BACKEND_URL}/api/downloads/proxy?url=${btoa(url)}`;
    
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.target = '_self'; // Open in same tab or trigger download directly
    a.download = 'movie.mp4';
    document.body.appendChild(a);
    a.click();
  };

  return (
    <div className="w-full">
      {/* Search Input */}
      <div className="mb-6">
        <input 
          type="text" 
          placeholder="Search downloads..." 
          value={searchQuery}
          onChange={handleSearchChange}
          className="w-full p-3 rounded-xl outline-none font-medium border-none shadow-sm"
          style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
        />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((item, idx) => (
          <div 
            key={`${item.id}-${idx}`} 
            onClick={() => openDownloadModal(item)}
            className="flex flex-col gap-2 cursor-pointer active:scale-95 transition-transform"
          >
            <img 
              src={item.poster} 
              alt={item.title} 
              className="w-full aspect-[2/3] object-cover rounded-xl shadow-md"
            />
            <div>
              <h3 className="font-bold text-sm leading-tight line-clamp-1">{item.title}</h3>
              {item.info && <p className="text-xs opacity-70 mt-1 line-clamp-1">{item.info}</p>}
            </div>
          </div>
        ))}
      </div>
      
      {loading && <div className="text-center mt-6 mb-6 opacity-80 font-medium">Loading...</div>}

      {!loading && items.length === 0 && (
        <div className="text-center mt-12 opacity-80 flex flex-col items-center gap-2">
          <span className="text-4xl">🎬</span>
          <p>No downloads found</p>
        </div>
      )}

      {/* Load More Button or VIP Call to Action */}
      {!isSearching && items.length > 0 && !loading && (
          <button
            onClick={() => setPage(p => p + 1)}
            className="w-full mt-6 p-4 rounded-xl font-bold transition-transform active:scale-95 shadow-md flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
          >
            Load More
          </button>
      )}

      {/* Download Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div 
            className="w-full max-w-sm p-6 rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--bg-color)' }}
          >
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold line-clamp-2">{selectedItem.title}</h2>
              <button 
                onClick={() => setSelectedItem(null)}
                className="p-2 rounded-full bg-black/20 ml-2"
              >
                ✕
              </button>
            </div>
            
            {loadingLinks ? (
              <div className="flex justify-center p-8">
                <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : downloadLinks.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm opacity-70 mb-2">Select video quality to download:</p>
                {downloadLinks.map((link, i) => (
                  <button
                    key={i}
                    onClick={() => triggerDownload(link.url)}
                    className="w-full p-4 rounded-xl font-bold flex justify-between items-center shadow-md active:scale-95 transition-transform"
                    style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
                  >
                    <span>{link.quality}</span>
                    <span className="opacity-80 text-sm">{link.size}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-center py-8 opacity-70">No download links available.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
