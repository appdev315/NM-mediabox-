import React, { useState, useEffect } from 'react';

const DOMAINS = [
  'a.magsrv.com',
  'a.ad-delivery.net',
  'syndication.exoclick.com'
];

export const ExoClickMainBanner = React.memo(function ExoClickMainBanner() {
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);
  const [domainIndex, setDomainIndex] = useState(0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let ticking = false;
    const handleResize = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setContainerWidth(window.innerWidth);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = containerWidth < 768;
  const zoneId = isMobile ? "5965686" : "5965676";
  const width = isMobile ? 320 : 900;
  const height = isMobile ? 50 : 250;

  const currentDomain = DOMAINS[domainIndex] || DOMAINS[0];
  const iframeUrl = `https://${currentDomain}/iframe.php?idzone=${zoneId}&size=${width}x${height}`;

  const handleError = () => {
    if (domainIndex + 1 < DOMAINS.length) {
      setDomainIndex(prev => prev + 1);
    } else {
      setHasError(true);
    }
  };

  if (hasError) {
    return null;
  }

  const padding = 24;
  const maxAvailableWidth = containerWidth - padding;
  const scale = maxAvailableWidth < width ? maxAvailableWidth / width : 1;
  const scaledHeight = height * scale;

  return (
    <div 
      className="w-full mb-4 mt-4 flex justify-center items-center overflow-hidden" 
      style={{ height: `${scaledHeight}px` }}
    >
      <div 
        style={{ 
          width: `${width}px`, 
          height: `${height}px`, 
          transform: `scale(${scale})`, 
          transformOrigin: 'top center',
          flexShrink: 0
        }}
      >
        <iframe
          src={iframeUrl}
          width={width}
          height={height}
          scrolling="no"
          frameBorder="0"
          onError={handleError}
          style={{ border: 'none', overflow: 'hidden' }}
        />
      </div>
    </div>
  );
});
