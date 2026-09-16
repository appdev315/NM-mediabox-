import React, { useEffect, useRef, useState } from 'react';

export const AdsterraNativeAd: React.FC<{ className?: string }> = ({ className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  // 1. Viewport observer: Only mount heavy ad scripts when user scrolls near the banner (250px margin)
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
      { rootMargin: '250px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 2. Load Adsterra Native script and container only once in proximity
  useEffect(() => {
    if (!isVisible || !containerRef.current) return;
    containerRef.current.innerHTML = '';

    const targetDiv = document.createElement('div');
    targetDiv.id = 'container-3208ff608ab1302402523bc766aa65a2';
    targetDiv.style.width = '100%';

    const script = document.createElement('script');
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    script.src = 'https://negotiatenapkin.com/3208ff608ab1302402523bc766aa65a2/invoke.js';

    containerRef.current.appendChild(targetDiv);
    containerRef.current.appendChild(script);

    const fallbackTimer = setTimeout(() => {
      if (containerRef.current) {
        const adContent = containerRef.current.querySelector('#container-3208ff608ab1302402523bc766aa65a2');
        if (!adContent || adContent.children.length === 0 || containerRef.current.offsetHeight === 0) {
          setShowFallback(true);
        }
      }
    }, 3500);

    return () => {
      clearTimeout(fallbackTimer);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [isVisible]);

  if (showFallback) {
    return null;
  }

  return (
    <div 
      ref={containerRef} 
      className={`w-full col-span-full my-2 flex justify-center items-center min-h-[100px] overflow-hidden ${className}`}
    />
  );
};


