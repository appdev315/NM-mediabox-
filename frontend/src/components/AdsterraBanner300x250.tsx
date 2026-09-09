import React, { useState } from 'react';

const SingleAdsterraBanner: React.FC<{ id?: string }> = ({ id = '0' }) => {
  return (
    <div 
      style={{ width: '300px', height: '250px', maxWidth: '100%', flexShrink: 0 }} 
      className="flex justify-center items-center rounded-xl overflow-hidden shadow-sm bg-transparent"
    >
      <iframe
        src={`/adsterra-banner.html?v=1&slot=${id}`}
        width="300"
        height="250"
        scrolling="no"
        frameBorder="0"
        title={`adsterra-banner-${id}`}
        style={{ width: '300px', height: '250px', border: 'none', overflow: 'hidden' }}
      />
    </div>
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
        <SingleAdsterraBanner key={idx} id={String(idx)} />
      ))}
    </div>
  );
};

