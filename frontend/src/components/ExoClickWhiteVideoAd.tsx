import { useEffect, useRef } from 'react';

export function ExoClickWhiteVideoAd() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    // Prevent double execution in React StrictMode
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      // 1. Ensure the ad script is present
      const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
      if (!scriptLoaded) {
        const script = document.createElement('script');
        script.async = true;
        script.type = 'application/javascript';
        script.src = 'https://a.magsrv.com/ad-provider.js';
        document.head.appendChild(script);
      }

      // 2. Clear any old ad artifacts if React re-rendered the component
      if (containerRef.current) {
        containerRef.current.innerHTML = '<ins class="eas6a97888e37" data-zoneid="5965150"></ins>';
      }

      // 3. Push the serve command
      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({"serve": {}});
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };

    // Small delay ensures the DOM is fully painted before ExoClick scans it
    const timer = setTimeout(loadAd, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div ref={containerRef} className="flex justify-center w-full my-4 min-h-[50px]">
      {/* The ins tag is injected via JS to prevent React from tracking its internal DOM changes */}
    </div>
  );
}
