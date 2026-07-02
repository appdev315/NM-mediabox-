import { useEffect, useRef } from 'react';

export function ExoClickInterstitial() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
      if (!scriptLoaded) {
        const script = document.createElement('script');
        script.async = true;
        script.type = 'application/javascript';
        script.src = 'https://a.pemsrv.com/ad-provider.js'; // Interstitial uses pemsrv in user screenshot
        document.head.appendChild(script);
      }

      if (containerRef.current) {
        containerRef.current.innerHTML = '<ins class="eas6a97888e33" data-zoneid="5964660" data-ex_av="name"></ins>';
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({"serve": {}});
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };

    const timer = setTimeout(loadAd, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div ref={containerRef}>
    </div>
  );
}
