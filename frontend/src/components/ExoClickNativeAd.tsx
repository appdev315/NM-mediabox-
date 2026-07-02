import { useEffect, useRef } from 'react';

interface ExoClickNativeAdProps {
  className?: string; // Expecting 'exo-banner-movie-card' or 'exo-banner-tv-card'
}

export default function ExoClickNativeAd({ className = 'col-span-full w-full my-2' }: ExoClickNativeAdProps) {
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    // Check if ANY exoclick ad provider script is already loaded
    const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
    
    if (!scriptLoaded) {
      const script = document.createElement('script');
      script.src = 'https://a.magsrv.com/ad-provider.js';
      script.async = true;
      script.type = 'application/javascript';
      document.head.appendChild(script);
    }

    // Run the ad push command
    const pushAd = () => {
      try {
        // @ts-ignore
        window.AdProvider = window.AdProvider || [];
        // @ts-ignore
        window.AdProvider.push({ "serve": {} });
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };
    
    const timer = setTimeout(pushAd, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={className}>
      <ins 
        ref={adRef}
        className="eas6a97888e20" 
        data-zoneid="5964558"
        style={className === 'col-span-full w-full my-2' ? { display: 'block', width: '100%' } : {}}
      ></ins>
    </div>
  );
}
