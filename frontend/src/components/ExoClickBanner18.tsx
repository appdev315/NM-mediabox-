import { useEffect, useRef, useState } from 'react';
import { BannerAd } from './BannerAd';

export function ExoClickBanner18() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Dynamically ensure ad-provider script exists
    if (!document.querySelector('script[src*="ad-provider.js"]')) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.magsrv.com/ad-provider.js';
      document.head.appendChild(script);
    }

    // Determine how many banners to show based on screen width (max 2)
    const width = window.innerWidth;
    const count = width >= 720 ? 2 : 1;

    const loadAd = () => {
      if (containerRef.current) {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex justify-center items-center gap-4 sm:gap-6 w-full max-w-full flex-wrap';
        for (let i = 0; i < count; i++) {
          const ins = document.createElement('ins');
          ins.className = 'eas6a97888e2 rounded-lg overflow-hidden max-w-full';
          ins.setAttribute('data-zoneid', '5965656');
          ins.setAttribute('data-ex_av', 'name');
          ins.style.display = 'inline-block';
          ins.style.width = '300px';
          ins.style.maxWidth = '100%';
          ins.style.height = '250px';
          wrapper.appendChild(ins);
        }
        containerRef.current.appendChild(wrapper);
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({ "serve": {} });
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };

    const timer = setTimeout(loadAd, 100);

    // AdBlock / load failure fallback check after 2 seconds
    const fallbackTimer = setTimeout(() => {
      if (containerRef.current) {
        const insElements = containerRef.current.querySelectorAll('ins');
        let filled = false;
        insElements.forEach((el) => {
          if (el.children.length > 0 && el.offsetHeight > 40) {
            filled = true;
          }
        });
        if (!filled) {
          setShowFallback(true);
        }
      }
    }, 2000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  if (showFallback) {
    return (
      <div className="w-full mb-4">
        <BannerAd variant="wide" type="adult" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full min-h-[250px] mb-4 flex justify-center items-center max-w-full overflow-hidden">
    </div>
  );
}

