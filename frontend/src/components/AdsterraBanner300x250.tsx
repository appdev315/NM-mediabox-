import React, { useState, useEffect, useRef } from 'react';

interface SingleBannerProps {
  id: string;
}

const SingleAdsterraBanner: React.FC<SingleBannerProps> = ({ id }) => {
  const [isVisible, setIsVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bannerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div 
      ref={bannerRef}
      style={{ width: '300px', height: '250px', maxWidth: '100%', flexShrink: 0 }} 
      className="relative flex justify-center items-center rounded-2xl overflow-hidden shadow-md bg-[#18181b] border border-amber-500/20 transition-all duration-300"
    >
      {/* Background Adsterra Iframe (Lazy-mounted upon viewport proximity) */}
      {isVisible ? (
        <iframe
          src={`/adsterra-banner.html?v=1&slot=${id}`}
          width="300"
          height="250"
          scrolling="no"
          frameBorder="0"
          loading="lazy"
          title={`adsterra-banner-${id}`}
          style={{ width: '300px', height: '250px', border: 'none', overflow: 'hidden' }}
        />
      ) : (
        <div className="w-[300px] h-[250px] bg-[#141416] flex items-center justify-center">
          <span className="text-2xl opacity-20">🍓</span>
        </div>
      )}
    </div>
  );
};

export const AdsterraBanner300x250: React.FC = () => {
  const [count] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      return 3;
    }
    return 1;
  });

  return (
    <div className="w-full flex justify-center items-center gap-4 sm:gap-6 my-3 flex-wrap overflow-hidden min-h-[250px]">
      {Array.from({ length: count }).map((_, idx) => (
        <SingleAdsterraBanner 
          key={idx} 
          id={String(idx)} 
        />
      ))}
    </div>
  );
};


