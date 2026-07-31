import { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { WebApp } from './telegram';
import { useLanguage } from './context/LanguageContext';

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
import { AdProvider } from './context/AdManager';
import { HomeStateProvider } from './context/HomeStateContext';
import { useNavigate } from 'react-router-dom';

import { useNetworkStatus } from './hooks/useNetworkStatus';
import { FloatingTitle } from './components/FloatingTitle';
import { TopBanner } from './components/TopBanner';

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

function BottomNav() {
  const location = useLocation();
  const { t } = useLanguage();
  
  if (location.pathname.includes('/movie/') || location.pathname.includes('/adult/')) return null;

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 flex justify-around p-3 border-t backdrop-blur-md z-40"
      style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--hint-color)' }}
    >
      <Link 
        to={location.pathname === '/favorites' ? '/' : '/favorites'} 
        className={`font-bold transition-opacity opacity-100 flex items-center justify-center w-full`}
        style={{ color: location.pathname === '/favorites' ? 'var(--button-color)' : 'var(--text-color)' }}
      >
        {location.pathname === '/favorites' ? t('home') : t('myFavorites')}
      </Link>
    </div>
  );
}

function MainApp() {
  return (
    <BrowserRouter>
      <DeepLinkHandler isAdultApp={false} />
      <NetworkBanner />
      <div className="pb-16 min-h-screen relative flex flex-col">
        <TopBanner />
        <Suspense fallback={<div className="min-h-[50vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/movies" element={<Home />} />
            <Route path="/movie/:id" element={<Movie />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/favorites" element={<Favorites />} />
          </Routes>
        </Suspense>
      </div>
      <BottomNav />
      <FloatingTitle />
      <GlobalAudioPlayer />
    </BrowserRouter>
  );
}

function AdultApp() {
  return (
    <BrowserRouter>
      <DeepLinkHandler isAdultApp={true} />
      <NetworkBanner />
      <div className="pb-16 min-h-screen relative">
        <Suspense fallback={<div className="min-h-[50vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
          <Routes>
            <Route path="/" element={<Adult />} />
            <Route path="/adult" element={<Adult />} />
            <Route path="/adult/:id" element={<AdultVideo />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/favorites" element={<AdultFavorites />} />
          </Routes>
        </Suspense>
      </div>
      <BottomNav />
      <FloatingTitle />
    </BrowserRouter>
  );
}

export default function App() {
  useEffect(() => {
    WebApp.ready();
    WebApp.expand();

    try {
      if (WebApp.setBackgroundColor) WebApp.setBackgroundColor('#17212b');
      if (WebApp.setHeaderColor) WebApp.setHeaderColor('#17212b');
    } catch (_) {}

    // Clean viewport realignment using official Telegram WebApp viewportChanged event
    const handleViewportChange = () => {
      try {
        WebApp.expand();
      } catch (_) {}
      window.dispatchEvent(new Event('resize'));
    };

    // When virtual keyboard closes on inputs, reset scroll position and stretch UI
    const handleFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        setTimeout(() => {
          window.scrollTo(0, 0);
          handleViewportChange();
        }, 50);
      }
    };

    try {
      if (WebApp.onEvent) {
        WebApp.onEvent('viewportChanged', handleViewportChange);
      }
    } catch (_) {}

    document.addEventListener('focusout', handleFocusOut);

    return () => {
      try {
        if (WebApp.offEvent) {
          WebApp.offEvent('viewportChanged', handleViewportChange);
        }
      } catch (_) {}
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
