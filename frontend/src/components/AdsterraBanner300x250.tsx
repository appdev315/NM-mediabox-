import React, { useEffect, useRef, useState } from 'react';

const SingleAdsterraBanner: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

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

    containerRef.current.appendChild(conf);
    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      style={{ width: '300px', height: '250px', maxWidth: '100%', flexShrink: 0 }} 
      className="flex justify-center items-center rounded-xl overflow-hidden shadow-sm"
    />
  );
};

export const AdsterraBanner300x250: React.FC = () => {
  const [count] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      return 3;
    }
    return 1;
  });

  return (
    <div className="w-full flex justify-center items-center gap-4 sm:gap-6 my-3 flex-wrap overflow-hidden min-h-[250px]">
      {Array.from({ length: count }).map((_, idx) => (
        <SingleAdsterraBanner key={idx} />
      ))}
    </div>
  );
};

