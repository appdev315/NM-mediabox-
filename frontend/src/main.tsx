import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LanguageProvider } from './context/LanguageContext'
import { ErrorBoundary } from './components/ErrorBoundary'

// Auto-reload once upon new bundle deploy to prevent stale chunk errors without loops
window.addEventListener('vite:preloadError', () => {
  const attempts = Number(sessionStorage.getItem('mb_preload_error_reload') || '0');
  if (attempts < 1) {
    sessionStorage.setItem('mb_preload_error_reload', '1');
    window.location.reload();
  }
});

// После успешного коммита дерева React снимаем защитные флаги reload-цикла с задержкой (15 секунд),
// предотвращая бесконечный цикл перезагрузок при периодических сбоях динамических импортов
function MountSuccess() {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        sessionStorage.removeItem('mb_pwa_heal_attempts');
        sessionStorage.removeItem('mb_preload_error_reload');
      } catch {}
    }, 15000);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MountSuccess />
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
