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

// После успешного коммита дерева React снимаем защитные флаги reload-цикла.
// Синхронный сброс сразу после render() бесполезен: монтирование асинхронно,
// и битый lazy-чанк успевал обнулить счётчик до падения — получался вечный reload.
function MountSuccess() {
  useEffect(() => {
    try {
      sessionStorage.removeItem('mb_pwa_heal_attempts');
      sessionStorage.removeItem('mb_preload_error_reload');
    } catch {}
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
