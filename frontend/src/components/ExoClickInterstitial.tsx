import { useEffect, useRef } from 'react';

export function ExoClickInterstitial() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear any existing ad to prevent duplicates from React re-renders
    containerRef.current.innerHTML = '';

    // Manually create and inject the <ins> tag to avoid React lifecycle interference
    const ins = document.createElement('ins');
    ins.className = "eas6a97888e33";
    ins.setAttribute("data-zoneid", "5964660");
    ins.setAttribute("data-ex_av", "name");
    containerRef.current.appendChild(ins);

    // Check if ANY exoclick ad provider script is already loaded
    const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
    
    if (!scriptLoaded) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.pemsrv.com/ad-provider.js';
      document.head.appendChild(script);
    }

    // Push the ad to the queue after injecting the tag
    const pushAd = () => {
      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({"serve": {}});
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };

    // Delay slightly to ensure browser has registered the injected DOM node
    const timer = setTimeout(pushAd, 150);
    
    return () => clearTimeout(timer);
  }, []);

  return <div ref={containerRef} className="exoclick-interstitial-container"></div>;
}
