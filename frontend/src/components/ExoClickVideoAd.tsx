import { useEffect, useRef } from 'react';

export function ExoClickVideoAd() {
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
        script.src = 'https://a.magsrv.com/ad-provider.js';
        document.head.appendChild(script);
      }

      if (containerRef.current) {
        // Add explicit styles to prevent collapse if iframe cross-origin sizing fails
        containerRef.current.innerHTML = '<ins class="eas6a97888e37" data-zoneid="5964652" data-ex_av="name" style="display: block; width: 100%; min-height: 200px;"></ins>';
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
    <div ref={containerRef} className="flex justify-center w-full my-4 min-h-[50px]">
    </div>
  );
}
