import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { WebApp } from '../telegram';
import VipModal from '../components/VipModal';

interface PhaseConfig {
  phase: number;
  priceMonth: number;
  priceLifetime: number | null;
  freeLimits: boolean;
  ads: boolean;
}

interface VipContextType {
  isVip: boolean;
  loading: boolean;
  showVipModal: () => void;
  config: PhaseConfig | null;
}

const VipContext = createContext<VipContextType | undefined>(undefined);

import { BACKEND_URL } from '../pages/Movie';

export const VipProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isVip, setIsVip] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [config, setConfig] = useState<PhaseConfig | null>(null);

  useEffect(() => {
    const checkStatusAndConfig = async () => {
      try {
        const initData = WebApp?.initData || '';
        
        if (!initData) {
          // No telegram initData (web outside app), disable VIP
          setIsVip(false);
          setLoading(false);
          return;
        }
        
        const [statusRes, configRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/vip/status`, {
            headers: { 'Authorization': `tma ${initData}` }
          }),
          fetch(`${BACKEND_URL}/api/config`)
        ]);
        
        if (statusRes.ok) {
          const data = await statusRes.json();
          setIsVip(!!data.isVip);
        } else {
          setIsVip(false);
        }
        if (configRes.ok) {
          const cfg = await configRes.json();
          setConfig(cfg);
        }
      } catch (e) {
        console.error('Failed to check VIP status or config', e);
        setIsVip(false);
      } finally {
        setLoading(false);
      }
    };
    checkStatusAndConfig();
  }, []);

  const showVipModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleBuy = async (plan: '1_month' | 'lifetime') => {
    try {
      const user = WebApp?.initDataUnsafe?.user;
      // If local testing and no TG:
      if (!user) {
        alert(`Смуляция покупки: ${plan}. Для теста VIP активирован!`);
        setIsVip(true);
        setIsModalOpen(false);
        return;
      }
      const res = await fetch(`${BACKEND_URL}/api/invoice`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `tma ${WebApp?.initData || ''}`
        },
        body: JSON.stringify({ plan, userId: user?.id })
      });
      const data = await res.json();
      
      if (data.invoiceUrl) {
        WebApp?.openInvoice(data.invoiceUrl, (status: string) => {
          if (status === 'paid') {
            setIsVip(true);
            setIsModalOpen(false);
            
            WebApp?.showPopup({
              title: 'VIP Активирован 💎',
              message: 'Спасибо за покупку! Теперь вы можете смотреть фильмы без рекламы, а также вам доступен наш приватный 18+ бот.',
              buttons: [
                { id: 'open_bot', type: 'default', text: '🔞 Открыть 18+ бота' },
                { type: 'close', text: 'Закрыть' }
              ]
            }, (buttonId: string) => {
              if (buttonId === 'open_bot') {
                WebApp.openTelegramLink('https://t.me/mediaboxxxbot');
              }
            });

          } else if (status === 'failed') {
            WebApp?.showAlert('Оплата не удалась. Попробуйте еще раз.');
          }
        });
      } else {
        WebApp?.showAlert('Ошибка создания счета: ' + (data.error || 'Неизвестная ошибка'));
      }
    } catch (e) {
      console.error(e);
      WebApp?.showAlert('Ошибка сети при создании счета.');
    }
  };

  return (
    <VipContext.Provider value={{ isVip, loading, showVipModal, config }}>
      {children}
      {isModalOpen && config && (
        <VipModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          onBuy={handleBuy} 
          config={config}
        />
      )}
    </VipContext.Provider>
  );
};

export const useVip = () => {
  const context = useContext(VipContext);
  if (context === undefined) {
    throw new Error('useVip must be used within a VipProvider');
  }
  return context;
};
