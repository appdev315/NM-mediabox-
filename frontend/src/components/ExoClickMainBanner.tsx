import React, { useEffect, useRef } from 'react';

const getAdNode = (isMobile: boolean) => {
  const globalVarName = isMobile ? '__exoMainAdMobile' : '__exoMainAdDesktop';
  const w = window as any;
  if (!w[globalVarName]) {
    const div = document.createElement('div');
    div.className = "exo-container";
    if (isMobile) {
      div.innerHTML = '<ins class="eas6a97888e10" data-zoneid="5965686" style="display:inline-block;width:320px;height:50px;"></ins>';
    } else {
      div.innerHTML = '<ins class="eas6a97888e2" data-zoneid="5965676" style="display:inline-block;width:728px;height:90px;"></ins>';
    }
    w[globalVarName] = div;
    
    setTimeout(() => {
      try {
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({"serve": {}});
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    }, 150);
  }
  return w[globalVarName];
};

export const ExoClickMainBanner = React.memo(function ExoClickMainBanner() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isMobile = window.innerWidth < 768;

  useEffect(() => {
    const adNode = getAdNode(isMobile);
    if (wrapperRef.current) {
      wrapperRef.current.appendChild(adNode);
    }
  }, [isMobile]);

  return (
    <div ref={wrapperRef} className="w-full mb-4 mt-4 relative z-10" style={{ minHeight: isMobile ? '50px' : '90px' }}>
      <style>{`
        .exo-container {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }
        .exo-container ins {
          display: inline-block !important;
          max-width: 100%;
        }
      `}</style>
    </div>
  );
});
