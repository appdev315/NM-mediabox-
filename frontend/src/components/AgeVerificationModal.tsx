import { useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { Header } from './Header';

interface AgeVerificationModalProps {
  onConfirm: () => void;
}

export function AgeVerificationModal({ onConfirm }: AgeVerificationModalProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="px-4 py-12 flex flex-col items-center text-center max-w-md mx-auto min-h-screen">
      <Header />
      <h1 className="text-3xl font-extrabold mb-4 mt-8">18+</h1>
      <div className="opacity-70 mb-8 leading-relaxed text-sm text-left bg-black/10 p-4 rounded-xl border border-white/10 shadow-inner flex flex-col gap-3">
        <p>
          <strong>{t('secretRoomRulesTitle')}</strong><br/>
          {t('secretRoomRule1')}<br/>
          {t('secretRoomRule2')}<br/>
          {t('secretRoomRule3')}
        </p>
        <p>
          {t('secretRoomWarning')}
        </p>
      </div>
      
      <div className="w-full flex flex-col gap-3">
        <button 
          onClick={onConfirm}
          className="w-full py-4 rounded-2xl font-bold text-lg active:scale-95 transition-transform"
          style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
        >
          {t('secretRoomConfirm')}
        </button>
        
        <button 
          onClick={() => {
            try {
              WebApp?.HapticFeedback?.notificationOccurred('error');
            } catch (_) {}
            navigate(-1);
          }}
          className="w-full py-4 rounded-2xl font-bold text-lg active:scale-95 transition-transform bg-transparent border-2"
          style={{ borderColor: 'var(--hint-color)', color: 'var(--text-color)' }}
        >
          {t('secretRoomLeave')}
        </button>
      </div>
    </div>
  );
}
