import { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { WebApp } from './telegram';
import { useLanguage } from './context/LanguageContext';
import { triggerViewportExpand } from './hooks/useViewportExpand';

import { GlobalAudioPlayer } from './components/GlobalAudioPlayer';
import { AudioPlayerProvider } from './context/AudioPlayerContext';
import { Home } from './pages/Home';

// Lazy-loaded routes for code-splitting and bundle size reduction
const Movie = lazy(() => import('./pages/Movie').then(m => ({ default: m.Movie })));
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })));
const Favorites = lazy(() => import('./pages/Favorites').then(m => ({ default: m.Favorites })));
const Adult = lazy(() => import('./pages/Adult').then(m => ({ default: m.Adult })));
const AdultVideo = lazy(() => import('./pages/AdultVideo').then(m => ({ default: m.AdultVideo })));
const AdultFavorites = lazy(() => import('./pages/AdultFavorites').then(m => ({ default: m.AdultFavorites })));

import { ThemeProvider } from './context/ThemeContext';
import { HomeStateProvider } from './context/HomeStateContext';
import { AdProvider } from './context/AdManager';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { FloatingTitle } from './components/FloatingTitle';
import { TopBanner } from './components/TopBanner';
import { trackVisit } from './utils/analytics';

function NetworkBanner() {
  const { isOnline } = useNetworkStatus();
  if (isOnline) return null;

  return (
    <div className="bg-amber-600/90 text-white text-xs font-semibold text-center py-1 px-3 w-full backdrop-blur-sm z-50 sticky top-0 animate-pulse">
      📡 Соединение частично отсутствует — используется локальный кэш
    </div>
  );
}

function DeepLinkHandler({ isAdultApp }: { isAdultApp: boolean }) {
  const navigate = useNavigate();
  
  useEffect(() => {
    const startParam = WebApp.initDataUnsafe?.start_param;
    if (startParam) {
      if (startParam === 'vip' && !isAdultApp) {
         // It used to redirect to /adult, but now adult is a different app.
         // We might just send them to profile in Main app so they can see the link
         navigate(`/profile`, { replace: true });
      } else if (startParam.includes('_') && !isAdultApp) {
        const [type, id] = startParam.split('_');
        navigate(`/movie/${id}?type=${type}`, { replace: true });
      } else if (!isAdultApp) {
        navigate(`/movie/${startParam}`, { replace: true });
      }
    }
  }, [navigate, isAdultApp]);

  return null;
}

function BottomNav({ isAdultApp = false }: { isAdultApp?: boolean }) {
  const location = useLocation();
  const { t } = useLanguage();
  
  if (location.pathname.includes('/movie/') || location.pathname.startsWith('/adult/')) return null;

  const isFav = isAdultApp ? location.pathname === '/adult/favorites' : location.pathname === '/favorites';
  const toUrl = isAdultApp 
    ? (isFav ? '/adult' : '/adult/favorites') 
    : (isFav ? '/' : '/favorites');

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 flex justify-around p-3 border-t backdrop-blur-md z-40"
      style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--hint-color)' }}
    >
      <Link 
        to={toUrl} 
        className="font-bold transition-opacity opacity-100 flex items-center justify-center w-full"
        style={{ color: isFav ? 'var(--button-color)' : 'var(--text-color)' }}
      >
        {isFav ? t('home') : t('myFavorites')}
      </Link>
    </div>
  );
}

function HardwareBackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  // Telegram WebApp BackButton sync
  useEffect(() => {
    try {
      if (WebApp && WebApp.BackButton) {
        const isRoot = location.pathname === '/' || location.pathname === '/movies' || location.pathname === '/adult';
        if (isRoot) {
          WebApp.BackButton.hide();
        } else {
          WebApp.BackButton.show();
          const handleBack = () => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate(location.pathname.startsWith('/adult') ? '/adult' : '/');
            }
          };
          WebApp.BackButton.onClick(handleBack);
          return () => {
            WebApp.BackButton.offClick(handleBack);
          };
        }
      }
    } catch (e) {
      console.warn('[BackButton] WebApp BackButton error:', e);
    }
  }, [location.pathname, navigate]);

  // Capacitor Android hardware back button
  useEffect(() => {
    let listenerHandle: any = null;
    try {
      CapacitorApp.addListener('backButton', ({ canGoBack }) => {
        const isRoot = location.pathname === '/' || location.pathname === '/movies' || location.pathname === '/adult';
        if (isRoot) {
          CapacitorApp.exitApp();
        } else if (canGoBack) {
          navigate(-1);
        } else {
          navigate(location.pathname.startsWith('/adult') ? '/adult' : '/');
        }
      }).then(handle => {
        listenerHandle = handle;
      });
    } catch (e) {
      console.warn('[BackButton] Capacitor listener setup error:', e);
    }

    return () => {
      if (listenerHandle && listenerHandle.remove) {
        listenerHandle.remove();
      }
    };
  }, [location.pathname, navigate]);

  return null;
}

function MainApp() {
  return (
    <BrowserRouter>
      <DeepLinkHandler isAdultApp={false} />
      <HardwareBackButtonHandler />
      <NetworkBanner />
      <div className="pb-16 min-h-screen relative flex flex-col">
        <TopBanner />
        <Suspense fallback={<div className="min-h-[50vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/movies" element={<Home />} />
            <Route path="/movie/:id" element={<Movie />} />
            <Route path="/adult" element={<Adult />} />
            <Route path="/adult/:id" element={<AdultVideo />} />
            <Route path="/adult/favorites" element={<AdultFavorites />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/favorites" element={<Favorites />} />
          </Routes>
        </Suspense>
      </div>
      <BottomNav isAdultApp={false} />
      <FloatingTitle />
      <GlobalAudioPlayer />
    </BrowserRouter>
  );
}

function AdultApp() {
  return (
    <BrowserRouter>
      <DeepLinkHandler isAdultApp={true} />
      <HardwareBackButtonHandler />
      <NetworkBanner />
      <div className="pb-16 min-h-screen relative">
        <Suspense fallback={<div className="min-h-[50vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
          <Routes>
            <Route path="/" element={<Adult />} />
            <Route path="/adult" element={<Adult />} />
            <Route path="/adult/:id" element={<AdultVideo />} />
            <Route path="/adult/favorites" element={<AdultFavorites />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/favorites" element={<AdultFavorites />} />
          </Routes>
        </Suspense>
      </div>
      <BottomNav isAdultApp={true} />
      <FloatingTitle />
    </BrowserRouter>
  );
}

export default function App() {
  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    trackVisit();

    try {
      if (WebApp.setBackgroundColor) WebApp.setBackgroundColor('#17212b');
      if (WebApp.setHeaderColor) WebApp.setHeaderColor('#17212b');
    } catch (e) {
      console.debug('[WebApp] Color config skipped:', e);
    }

    let appViewportTimers: ReturnType<typeof setTimeout>[] = [];

    // Clean viewport realignment using official Telegram WebApp viewportChanged event
    const handleViewportChange = () => {
      triggerViewportExpand();
      
      // Clear previous pending timers
      appViewportTimers.forEach(clearTimeout);
      appViewportTimers = [];

      // Stepped cascade to ensure full expansion after keyboard closing animation (300-600ms)
      [100, 300, 600].forEach(delay => {
        const timer = setTimeout(() => {
          triggerViewportExpand();
          if (window.visualViewport && window.visualViewport.height >= window.innerHeight - 10) {
            appViewportTimers.forEach(clearTimeout);
          }
        }, delay);
        appViewportTimers.push(timer);
      });
    };

    // When virtual keyboard closes on inputs, recalculate layout without jumping to top
    const handleFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        requestAnimationFrame(() => {
          // Only trigger if focus actually moved outside inputs (not switching between inputs)
          const activeTag = document.activeElement?.tagName;
          if (!activeTag || !['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) {
            handleViewportChange();
          }
        });
      }
    };

    const handleVisualViewportResize = () => {
      if (window.visualViewport && window.visualViewport.height >= window.innerHeight - 50) {
        handleViewportChange();
      }
    };

    try {
      if (WebApp.onEvent) {
        WebApp.onEvent('viewportChanged', handleViewportChange);
      }
    } catch (e) {
      console.debug('[WebApp] viewportChanged listener skipped:', e);
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportResize);
    }
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      appViewportTimers.forEach(clearTimeout);
      try {
        if (WebApp.offEvent) {
          WebApp.offEvent('viewportChanged', handleViewportChange);
        }
      } catch (e) {
        console.debug('[WebApp] offEvent skipped:', e);
      }
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
      }
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const hostname = window.location.hostname;
  const isAdultDomain = window.location.hostname === 'moviemaniak5555.xyz' || (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.href.includes('app=adult');
  
  const isAdultApp = isAdultDomain || isAdultQuery;
  
  // Use a simple title since we can't easily use t() here without wrapping the component
  useEffect(() => {
    document.title = isAdultApp ? 'Secret Room 🍓' : 'MediaBox 🍿';
  }, [isAdultApp]);

  return (
    <ThemeProvider>
      <AudioPlayerProvider>
        <HomeStateProvider>
          <AdProvider>
            <>
              {isAdultApp ? <AdultApp /> : <MainApp />}
            </>
          </AdProvider>
        </HomeStateProvider>
      </AudioPlayerProvider>
    </ThemeProvider>
  );
}
