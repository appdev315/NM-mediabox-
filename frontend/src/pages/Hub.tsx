import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';

export function Hub() {
  const [showPrivate, setShowPrivate] = useState(true);
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    // Check showPrivate setting
    const savedShowPrivate = localStorage.getItem('showPrivate');
    if (savedShowPrivate === 'false') {
      setShowPrivate(false);
    }
  }, []);

  const allTiles = [
    {
      id: 'movie',
      to: '/movies',
      title: t('movies_and_series'),
      subtitle: t('subtitle_movies'),
      icon: '🎬',
      gradient: 'from-blue-500/15 to-purple-600/15 border-blue-500/20',
      animClass: 'animate-movie',
    },
    {
      id: 'radio',
      to: '/radio-tv',
      title: t('radio_and_tv'),
      subtitle: t('subtitle_radio'),
      icon: '📻',
      gradient: 'from-orange-500/15 to-red-600/15 border-orange-500/20',
      animClass: 'animate-radio',
    },

    {
      id: 'adult',
      to: '/adult',
      title: t('privateContent'),
      subtitle: t('subtitle_adult'),
      icon: '🍓',
      gradient: 'from-pink-500/15 to-rose-600/15 border-pink-500/20',
      animClass: 'animate-adult-strawberry',
      isPrivate: true
    },
  ];

  // Always show all tiles; Private is always visible
  // Respect showPrivate toggle (hide if they chose to hide it)
  const tiles = allTiles.filter(t => !t.isPrivate || showPrivate);

  const scrollLeft = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -window.innerWidth, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: window.innerWidth, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-140px)] flex items-center justify-center overflow-hidden">
      {/* Navigation Arrows for Web */}
      <button 
        onClick={scrollLeft}
        className="hidden md:flex absolute left-4 z-20 w-12 h-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md shadow-lg transition-all"
        style={{ color: 'var(--text-color)' }}
      >
        <span className="text-2xl opacity-70">‹</span>
      </button>

      <button 
        onClick={scrollRight}
        className="hidden md:flex absolute right-4 z-20 w-12 h-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md shadow-lg transition-all"
        style={{ color: 'var(--text-color)' }}
      >
        <span className="text-2xl opacity-70">›</span>
      </button>

      <div 
        ref={scrollRef}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide items-center px-4 md:px-0"
        style={{ scrollBehavior: 'smooth' }}
      >
        {tiles.map((tile, index) => (
          <div key={index} className="w-full h-full flex-shrink-0 snap-center flex items-center justify-center p-4">
            <Link
              to={tile.to}
              className={`relative overflow-hidden rounded-[40px] w-full max-w-sm aspect-[4/5] md:aspect-[3/4] flex flex-col items-center justify-center transition-all transform active:scale-[0.97] border border-white/5 shadow-2xl bg-gradient-to-br ${tile.gradient}`}
              style={{ backdropFilter: 'blur(20px)' }}
              onClick={(e) => {
                e.preventDefault();
                if (animatingId) return;
                setAnimatingId(tile.id);
                setTimeout(() => {
                  navigate(tile.to);
                }, 650);
              }}
            >
              <div className="flex flex-col items-center justify-center gap-8 relative z-10 w-full h-full p-8 text-center">
                <div className="relative text-8xl md:text-9xl drop-shadow-2xl filter transition-transform duration-500">
                  <div className={animatingId === tile.id ? tile.animClass : ''}>
                    {tile.icon}
                  </div>
                  {tile.id === 'adult' && animatingId === 'adult' && (
                    <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center animate-adult-lips pointer-events-none text-7xl">
                      💋
                    </div>
                  )}
                </div>
                
                <div className="flex flex-col items-center justify-center mt-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-3xl md:text-4xl font-extrabold tracking-tight drop-shadow-md" style={{ color: 'var(--text-color)' }}>
                      {tile.title}
                    </span>
                  </div>
                  <span className="text-lg md:text-xl font-medium opacity-80 drop-shadow-sm" style={{ color: 'var(--text-color)' }}>
                    {tile.subtitle}
                  </span>
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>


    </div>
  );
}
