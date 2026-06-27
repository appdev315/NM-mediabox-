import React, { useState } from 'react';
import { X, Diamond, CheckCircle } from 'lucide-react';


interface VipModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBuy: (plan: '1_month' | 'lifetime') => void;
  config: any;
}

const VipModal: React.FC<VipModalProps> = ({ isOpen, onClose, onBuy, config }) => {
  
  const [isAdultConfirmed, setIsAdultConfirmed] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div className="relative w-full max-w-sm rounded-3xl p-6 shadow-2xl flex flex-col gap-5 border border-white/10"
           style={{ background: 'linear-gradient(145deg, #1e2025 0%, #15161a 100%)' }}>
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center text-center mt-2">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-400 to-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.3)] mb-4">
            <Diamond className="w-8 h-8 text-white drop-shadow-md" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Откройте всё с VIP</h2>
          <p className="text-white/60 text-sm leading-relaxed px-2">
            Поддержите проект, чтобы получить безлимитный доступ ко всем фильмам, ТВ и эксклюзивному контенту!
          </p>
        </div>

        {/* Features List */}
        <div className="flex flex-col gap-3 my-2 bg-white/[0.03] rounded-2xl p-4 border border-white/[0.05]">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-white/80 text-sm font-medium">Бесконечная лента контента</span>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-white/80 text-sm font-medium">Доступ к ТВ и Радио</span>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-white/80 text-sm font-medium">Приватная коллекция (18+)</span>
          </div>
        </div>

        {/* Age Confirmation */}
        <label className="flex items-start gap-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 cursor-pointer active:scale-[0.98] transition-transform">
          <div className="pt-0.5">
            <input 
              type="checkbox" 
              className="w-5 h-5 rounded accent-orange-500 bg-white/10 border-white/20"
              checked={isAdultConfirmed}
              onChange={(e) => setIsAdultConfirmed(e.target.checked)}
            />
          </div>
          <p className="text-orange-200/80 text-xs font-medium leading-snug">
            Мне есть 18 лет, и я принимаю на себя ответственность за просмотр контента.
          </p>
        </label>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 mt-2">
          <button
            disabled={!isAdultConfirmed}
            onClick={() => onBuy('1_month')}
            className={`w-full py-3.5 rounded-2xl font-bold text-[15px] transition-all flex items-center justify-center gap-2 ${
              isAdultConfirmed 
                ? 'bg-[#0088cc] hover:bg-[#0099e6] text-white shadow-[0_4px_15px_rgba(0,136,204,0.3)] active:scale-95'
                : 'bg-white/5 text-white/30 cursor-not-allowed'
            }`}
          >
            Купить 1 месяц — {config?.priceMonth || 75} ⭐️
          </button>
          
          {config?.priceLifetime !== null && (
            <button
              disabled={!isAdultConfirmed}
              onClick={() => onBuy('lifetime')}
              className={`w-full py-3.5 rounded-2xl font-bold text-[15px] transition-all flex items-center justify-center gap-2 ${
                isAdultConfirmed 
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-[0_4px_15px_rgba(236,72,153,0.3)] active:scale-95'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              VIP Навсегда — {config?.priceLifetime} ⭐️
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VipModal;
