import { useEffect, useRef } from 'react';

export function ExoClickInterstitial() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if ANY exoclick ad provider script is already loaded
    const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
    
    if (!scriptLoaded) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.pemsrv.com/ad-provider.js';
      document.head.appendChild(script);
    }

    // Push the ad to the queue
    const pushAd = () => {
      const w = window as any;
      w.AdProvider = w.AdProvider || [];
      w.AdProvider.push({"serve": {}});
    };

    // Give it a tiny delay to ensure the DOM has painted the <ins> tag
    const timer = setTimeout(pushAd, 100);
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <div ref={containerRef} style={{ display: 'none' }}>
      <ins className="eas6a97888e33" data-zoneid="5964660"></ins>
    </div>
  );
}
