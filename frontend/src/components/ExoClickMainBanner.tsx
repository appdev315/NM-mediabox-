import React from 'react';

export const ExoClickMainBanner = React.memo(function ExoClickMainBanner() {
  const isMobile = window.innerWidth < 768;
  const zoneId = isMobile ? "5965686" : "5965676";
  const width = isMobile ? "320" : "728";
  const height = isMobile ? "50" : "90";
  const iframeUrl = `https://a.magsrv.com/iframe.php?idzone=${zoneId}&size=${width}x${height}`;

  return (
    <div className="w-full mb-4 mt-4 flex justify-center items-center overflow-hidden" style={{ minHeight: `${height}px` }}>
      <iframe
        src={iframeUrl}
        width={width}
        height={height}
        scrolling="no"
        frameBorder="0"
        style={{ border: 'none', overflow: 'hidden' }}
      />
    </div>
  );
});
