import React, { useState, useEffect, useRef } from 'react';

interface MovieBottomBannerProps {
  className?: string;
  slotId?: string;
}

export const MovieBottomBanner: React.FC<MovieBottomBannerProps> = ({ 
  className = "my-6", 
  slotId = "default" 
}) => {
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // Teardown on unmount to release GPU process video memory
  useEffect(() => {
    return () => {
      if (iframeRef.current) {
        try { iframeRef.current.src = 'about:blank'; } catch (_) {}
      }
    };
  }, []);

  return (
    <div ref={containerRef} className={`w-full flex flex-col items-center justify-center px-2 overflow-hidden select-none ${className}`}>
      {isVisible && (
        isDesktop ? (
          /* Desktop & Tablet Banner: 728x90 */
          <div className="flex justify-center items-center w-[728px] h-[90px] max-w-full rounded-xl overflow-hidden bg-[#12141a]/60 border border-white/10 shadow-lg">
            <iframe
              ref={iframeRef}
              src={`/adsterra-movie-leaderboard?v=1&slot=${slotId}`}
              width="728"
              height="90"
              scrolling="no"
              frameBorder="0"
              title={`adsterra-movie-leaderboard-${slotId}`}
              style={{ width: '728px', height: '90px', border: 'none', overflow: 'hidden' }}
            />
          </div>
        ) : (
          /* Mobile Banner: 320x50 */
          <div className="flex justify-center items-center w-[320px] h-[50px] max-w-full rounded-xl overflow-hidden bg-[#12141a]/60 border border-white/10 shadow-md">
            <iframe
              ref={iframeRef}
              src={`/adsterra-movie-mobile-banner?v=1&slot=${slotId}`}
              width="320"
              height="50"
              scrolling="no"
              frameBorder="0"
              title={`adsterra-movie-mobile-banner-${slotId}`}
              style={{ width: '320px', height: '50px', border: 'none', overflow: 'hidden' }}
            />
          </div>
        )
      )}
    </div>
  );
};
