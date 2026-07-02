import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { WebApp } from './telegram';
import { useLanguage } from './context/LanguageContext';
import AdBanner from './components/AdBanner';
import { MonetagScript } from './components/MonetagScript';

import { Home } from './pages/Home';
import { Movie } from './pages/Movie';
import { Profile } from './pages/Profile';
import { Adult } from './pages/Adult';
import { Favorites } from './pages/Favorites';
import { AdultVideo } from './pages/AdultVideo';
import { AdultFavorites } from './pages/AdultFavorites';
import { RadioTV } from './pages/RadioTV';
import { AudioPlayerProvider } from './context/AudioPlayerContext';
import { GlobalAudioPlayer } from './components/GlobalAudioPlayer';
import { VipProvider } from './context/VipContext';
import { AdProvider } from './context/AdManager';
import { ThemeProvider } from './context/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { VIP_USERS } from './config/vipUsers';
import { FloatingTitle } from './components/FloatingTitle';

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
        <span className="mr-2">⭐️</span> {location.pathname === '/favorites' ? t('home') : t('myFavorites')}
      </Link>
    </div>
  );
}

function MainApp() {
  return (
    <BrowserRouter>
      <DeepLinkHandler isAdultApp={false} />
      <div className="pb-16 min-h-screen relative flex flex-col">
        <AdBanner />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/movies" element={<Home />} />
          <Route path="/radio-tv" element={<RadioTV />} />
          <Route path="/movie/:id" element={<Movie />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/favorites" element={<Favorites />} />
          {/* Adult route removed! */}
        </Routes>
      </div>
      <GlobalAudioPlayer />
      <BottomNav />
      <FloatingTitle />
    </BrowserRouter>
  );
}

function AdultApp() {
  return (
    <BrowserRouter>
      <DeepLinkHandler isAdultApp={true} />
      <div className="pb-16 min-h-screen relative">
        <Routes>
          <Route path="/" element={<Adult />} />
          <Route path="/adult" element={<Adult />} />
          <Route path="/adult/:id" element={<AdultVideo />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/favorites" element={<AdultFavorites />} />
        </Routes>
      </div>
      <BottomNav />
      <FloatingTitle />
    </BrowserRouter>
  );
}

export default function App() {
  useEffect(() => {
    WebApp.ready();
    
    // Auto-grant VIP to users in the VIP list (legacy local storage grant, backend handles actual logic)
    const user = WebApp.initDataUnsafe?.user;
    if (user?.username && VIP_USERS.includes(user.username)) {
      localStorage.setItem('vip_until', 'lifetime');
      localStorage.setItem('age_confirmed', 'true');
    }
  }, []);

  const hostname = window.location.hostname;
  const isAdultDomain = (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.search.includes('app=adult');
  
  const isAdultApp = isAdultDomain || isAdultQuery;
  
  useEffect(() => {
    document.title = isAdultApp ? 'MediaBoxxx 🍓' : 'MovieManiak 🍿';
  }, [isAdultApp]);

  return (
    <ThemeProvider>
      <VipProvider>
        <AdProvider>
          <AudioPlayerProvider>
            {!isAdultApp && <MonetagScript />}
            {isAdultApp ? <AdultApp /> : <MainApp />}
          </AudioPlayerProvider>
        </AdProvider>
      </VipProvider>
    </ThemeProvider>
  );
}
