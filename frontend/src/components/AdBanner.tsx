import React from 'react';
import { useVip } from '../context/VipContext';

const AdBanner: React.FC = () => {
  const { isVip, config } = useVip();

  // Показывать баннер только если включена реклама (config.ads === true) и пользователь не VIP
  if (!config?.ads || isVip) {
    return null;
  }

  return (
    <div className="fixed bottom-20 left-0 right-0 z-[100] p-2 flex justify-center pointer-events-none">
      <div 
        className="w-full max-w-sm rounded-xl p-3 shadow-lg border backdrop-blur-md pointer-events-auto flex items-center justify-between"
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.7)', 
          borderColor: 'rgba(255, 255, 255, 0.2)',
          color: 'white'
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center font-bold">
            AD
          </div>
          <div>
            <h4 className="font-bold text-sm">Место для рекламы</h4>
            <p className="text-xs opacity-70">Здесь будет баннер Adsgram</p>
          </div>
        </div>
        <button className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
          Открыть
        </button>
      </div>
    </div>
  );
};

export default AdBanner;
