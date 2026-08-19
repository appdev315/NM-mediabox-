import React, { useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';

interface IosInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IosInstallModal: React.FC<IosInstallModalProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm sm:max-w-md bg-gradient-to-b from-gray-900 via-gray-900 to-black rounded-3xl border border-white/15 p-6 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Background decorative glow */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-all active:scale-95"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* App Icon & Title Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="relative mb-3">
            <img
              src="/apple-touch-icon.png"
              alt="MediaBox"
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl shadow-xl shadow-blue-500/10 border border-white/20 object-cover"
            />
            <div className="absolute -bottom-1 -right-1 bg-blue-600 rounded-full p-1 border-2 border-gray-900 shadow">
              <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.61-.75 1.04-1.8 1.01-2.87-.96.04-2.13.65-2.77 1.4-.56.64-.99 1.72-.94 2.76 1.08.08 2.18-.54 2.7-1.29z"/>
              </svg>
            </div>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white tracking-wide">
            {t('iosInstallTitle') || 'Установка на iPhone & iPad'}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            MediaBox PWA
          </p>
        </div>

        {/* Step-by-step guides */}
        <div className="space-y-3 mb-6">
          {/* Step 1 */}
          <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              {/* Safari Share Icon */}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider block">1. Шаг 1</span>
              <p className="text-xs sm:text-sm text-gray-200 font-medium leading-snug">
                {t('iosStep1') || 'В Safari нажмите «Поделиться» (иконка внизу)'}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              {/* Add to Home Screen Icon */}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider block">2. Шаг 2</span>
              <p className="text-xs sm:text-sm text-gray-200 font-medium leading-snug">
                {t('iosStep2') || 'Выберите «На экран «Домой»»'}
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
              {/* Add Confirmation Icon */}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider block">3. Шаг 3</span>
              <p className="text-xs sm:text-sm text-gray-200 font-medium leading-snug">
                {t('iosStep3') || 'В правом верхнем углу нажмите «Добавить»'}
              </p>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer"
        >
          {t('gotIt') || 'Понятно'}
        </button>
      </div>
    </div>
  );
};
