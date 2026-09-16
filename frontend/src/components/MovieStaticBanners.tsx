import React, { useState, useEffect, useRef } from 'react';

export const MovieStaticBanners: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(min-width: 768px)');
    setIsDesktop(media.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
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

  // Teardown iframes on unmount to release memory
  useEffect(() => {
    return () => {
      if (containerRef.current) {
        containerRef.current.querySelectorAll('iframe').forEach(f => {
          try { f.src = 'about:blank'; } catch (_) {}
        });
      }
    };
  }, []);

  const bannerSlots = isDesktop ? [0, 1] : [0];

  return (
    <div ref={containerRef} className="w-full my-6 border-t border-white/10 pt-6">
      <div className="w-full flex justify-center items-center gap-4 sm:gap-6 flex-wrap overflow-hidden min-h-[250px]">
        {isVisible ? (
          bannerSlots.map((idx) => (
            <div
              key={idx}
              style={{ width: '300px', height: '250px', maxWidth: '100%', flexShrink: 0 }}
              className="flex justify-center items-center rounded-2xl overflow-hidden shadow-lg bg-[#18181b] border border-white/10 transition-all hover:border-white/20"
            >
              <iframe
                src={`/adsterra-movie-banner.html?v=1&slot=static-${idx}`}
                width="300"
                height="250"
                scrolling="no"
                frameBorder="0"
                title={`adsterra-static-banner-${idx}`}
                style={{ width: '300px', height: '250px', border: 'none', overflow: 'hidden' }}
              />
            </div>
          ))
        ) : (
          <div style={{ width: '300px', height: '250px' }} className="rounded-2xl bg-[#18181b]/30" />
        )}
      </div>
    </div>
  );
};
