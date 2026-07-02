import { useEffect, useRef } from 'react';

interface ExoClickWhiteAdProps {
  className?: string; // Expecting 'exo-banner-movie-card' or 'exo-banner-tv-card'
}

export default function ExoClickWhiteAd({ className = 'exo-banner-movie-card' }: ExoClickWhiteAdProps) {
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
    try {
      // @ts-ignore
      window.AdProvider = window.AdProvider || [];
      // @ts-ignore
      window.AdProvider.push({ "serve": {} });
    } catch (e) {
      console.error('ExoClick Ad Error:', e);
    }
  }, []);

  return (
    <div className={className}>
      <ins 
        ref={adRef}
        className="eas6a97888e20" 
        data-zoneid="5964976"
        style={className.includes('exo-banner-') ? { display: 'block', width: '100%', height: '100%' } : {}}
      ></ins>
    </div>
  );
}
