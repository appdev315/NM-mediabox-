import React, { useState, useEffect } from 'react';

export const ExoClickMainBanner = React.memo(function ExoClickMainBanner() {
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => {
      setContainerWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = containerWidth < 768;
  const zoneId = isMobile ? "5965686" : "5965676";
  
  // Sizing based on user settings: desktop is 900x250, mobile is 320x50.
  const width = isMobile ? 320 : 900;
  const height = isMobile ? 50 : 250;
  const iframeUrl = `https://a.magsrv.com/iframe.php?idzone=${zoneId}&size=${width}x${height}`;

  // Calculate scaling factor if container width is smaller than the banner width (with 24px padding margin)
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
          style={{ border: 'none', overflow: 'hidden' }}
        />
      </div>
    </div>
  );
});
