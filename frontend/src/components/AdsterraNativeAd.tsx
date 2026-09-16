import React, { useEffect, useRef, useState } from 'react';

export const AdsterraNativeAd: React.FC<{ className?: string }> = ({ className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const targetDiv = document.createElement('div');
    targetDiv.id = 'container-3208ff608ab1302402523bc766aa65a2';
    targetDiv.style.width = '100%';

    const script = document.createElement('script');
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    script.src = 'https://negotiatenapkin.com/3208ff608ab1302402523bc766aa65a2/invoke.js';

    containerRef.current.appendChild(targetDiv);
    containerRef.current.appendChild(script);

    const fallbackTimer = setTimeout(() => {
      if (containerRef.current) {
        const adContent = containerRef.current.querySelector('#container-3208ff608ab1302402523bc766aa65a2');
        if (!adContent || adContent.children.length === 0 || containerRef.current.offsetHeight === 0) {
          setShowFallback(true);
        }
      }
    }, 2500);

    return () => {
      clearTimeout(fallbackTimer);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  if (showFallback) {
    return null;
  }

  return (
    <div 
      ref={containerRef} 
      className={`w-full col-span-full my-2 flex justify-center items-center min-h-[100px] overflow-hidden ${className}`}
    />
  );
};

