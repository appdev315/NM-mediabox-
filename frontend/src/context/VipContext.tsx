import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { WebApp } from '../telegram';
import VipModal from '../components/VipModal';

interface VipContextType {
  isVip: boolean;
  loading: boolean;
  showVipModal: () => void;
}

const VipContext = createContext<VipContextType | undefined>(undefined);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://server.moviemaniak5555.xyz';

export const VipProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isVip, setIsVip] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const checkVipStatus = async () => {
      try {
        const initData = WebApp?.initData || '';
        if (!initData) {
          // Local testing fallback
          setIsVip(false);
          setLoading(false);
          return;
        }
        const res = await fetch(`${BACKEND_URL}/api/vip/status`, {
          headers: { 'Authorization': `tma ${initData}` }
        });
        if (res.ok) {
          const data = await res.json();
          setIsVip(data.isVip);
        }
      } catch (e) {
        console.error('Failed to check VIP status', e);
      } finally {
        setLoading(false);
      }
    };
    checkVipStatus();
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, userId: user?.id })
      });
      const data = await res.json();
      
      if (data.invoiceUrl) {
        WebApp?.openInvoice(data.invoiceUrl, (status: string) => {
          if (status === 'paid') {
            setIsVip(true);
            setIsModalOpen(false);
            WebApp?.showAlert('Спасибо за покупку! VIP-доступ активирован 💎');
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
    <VipContext.Provider value={{ isVip, loading, showVipModal }}>
      {children}
      <VipModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onBuy={handleBuy} 
      />
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
