import { useEffect, useRef } from 'react';

export function ExoClickVideoAd() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if ANY exoclick ad provider script is already loaded
    const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
    
    if (!scriptLoaded) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.magsrv.com/ad-provider.js';
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
    <div ref={containerRef} className="flex justify-center w-full my-4">
      <ins className="eas6a97888e37" data-zoneid="5964652" data-ex_av="name"></ins>
    </div>
  );
}
