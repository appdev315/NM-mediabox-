import { useEffect, useRef } from 'react';

interface ExoClickNativeAdProps {
  className?: string; // Expecting 'exo-banner-movie-card' or 'exo-banner-tv-card'
}

export default function ExoClickNativeAd({ className = 'exo-banner-movie-card' }: ExoClickNativeAdProps) {
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    // Load the main provider script if it's not already loaded
    if (!document.querySelector('script[src="https://a.magsrv.com/ad-provider.js"]')) {
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
      ></ins>
    </div>
  );
}
