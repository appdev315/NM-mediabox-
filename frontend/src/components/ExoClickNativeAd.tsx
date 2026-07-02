import { useEffect, useRef } from 'react';

interface ExoClickNativeAdProps {
  className?: string; // Expecting 'exo-banner-movie-card' or 'exo-banner-tv-card'
}

export default function ExoClickNativeAd({ className = 'exo-banner-movie-card' }: ExoClickNativeAdProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
      if (!scriptLoaded) {
        const script = document.createElement('script');
        script.src = 'https://a.magsrv.com/ad-provider.js';
        script.async = true;
        script.type = 'application/javascript';
        document.head.appendChild(script);
      }

      if (containerRef.current) {
        // According to user screenshot, 18+ Widget requires data-ex_av="name"
        containerRef.current.innerHTML = '<ins class="eas6a97888e20" data-zoneid="5964558" data-ex_av="name"></ins>';
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({ "serve": {} });
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };
    
    const timer = setTimeout(loadAd, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div ref={containerRef} className={className + " min-h-[50px] flex justify-center items-center overflow-hidden"}>
    </div>
  );
}
