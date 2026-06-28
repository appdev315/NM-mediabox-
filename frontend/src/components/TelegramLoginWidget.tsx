import React, { useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';

interface TelegramLoginWidgetProps {
  botName: string;
  onAuth: (user: any) => void;
  buttonSize?: 'large' | 'medium' | 'small';
  cornerRadius?: number;
  requestAccess?: string;
  usePic?: boolean;
}

export const TelegramLoginWidget: React.FC<TelegramLoginWidgetProps> = ({
  botName,
  onAuth,
  buttonSize = 'large',
  cornerRadius = 20,
  requestAccess = 'write',
  usePic = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { language } = useLanguage();

  useEffect(() => {
    (window as any).onTelegramAuth = (user: any) => {
      onAuth(user);
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', buttonSize);
    script.setAttribute('data-radius', String(cornerRadius));
    script.setAttribute('data-request-access', requestAccess);
    script.setAttribute('data-userpic', String(usePic));
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    
    // Set language from context ('ru-RU' -> 'ru', 'en-US' -> 'en')
    script.setAttribute('data-lang', language.split('-')[0]);
    
    script.async = true;

    if (containerRef.current) {
      containerRef.current.appendChild(script);
    }

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      delete (window as any).onTelegramAuth;
    };
  }, [botName, onAuth, buttonSize, cornerRadius, requestAccess, usePic, language]);

  return <div ref={containerRef} className="flex justify-center mt-2" />;
};
