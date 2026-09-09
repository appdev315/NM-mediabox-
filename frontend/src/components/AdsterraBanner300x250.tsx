import React, { useEffect, useRef, useState } from 'react';
import { BannerAd } from './BannerAd';

export const AdsterraBanner300x250: React.FC = () => {
  const bannerRef = useRef<HTMLDivElement>(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!bannerRef.current) return;
    bannerRef.current.innerHTML = '';

    const conf = document.createElement('script');
    conf.type = 'text/javascript';
    conf.innerHTML = `
      atOptions = {
        'key' : 'e6118425b43ea5b0ff7aa13e8dbd4c3a',
        'format' : 'iframe',
        'height' : 250,
        'width' : 300,
        'params' : {}
      };
    `;

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://www.highrevenueformat.com/e6118425b43ea5b0ff7aa13e8dbd4c3a/invoke.js';

    bannerRef.current.appendChild(conf);
    bannerRef.current.appendChild(script);

    const fallbackTimer = setTimeout(() => {
      if (bannerRef.current) {
        const iframe = bannerRef.current.querySelector('iframe');
        if (!iframe || iframe.offsetHeight === 0) {
          setShowFallback(true);
        }
      }
    }, 2500);

    return () => {
      clearTimeout(fallbackTimer);
      if (bannerRef.current) {
        bannerRef.current.innerHTML = '';
      }
    };
  }, []);

  if (showFallback) {
    return (
      <div className="w-full mb-4">
        <BannerAd variant="wide" type="adult" />
      </div>
    );
  }

  return (
    <div className="w-full flex justify-center items-center my-3 overflow-hidden min-h-[250px]">
      <div ref={bannerRef} style={{ width: '300px', height: '250px', maxWidth: '100%' }} />
    </div>
  );
};
