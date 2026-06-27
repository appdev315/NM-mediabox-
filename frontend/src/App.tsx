import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { WebApp } from './telegram';
import { useLanguage } from './context/LanguageContext';

import { Home } from './pages/Home';
import { Movie } from './pages/Movie';
import { Profile } from './pages/Profile';
import { Adult } from './pages/Adult';
import { Favorites } from './pages/Favorites';
import { AdultVideo } from './pages/AdultVideo';
import { RadioTV } from './pages/RadioTV';
import { AudioPlayerProvider } from './context/AudioPlayerContext';
import { GlobalAudioPlayer } from './components/GlobalAudioPlayer';

import { useNavigate } from 'react-router-dom';

function DeepLinkHandler() {
  const navigate = useNavigate();
  
  useEffect(() => {
    const startParam = WebApp.initDataUnsafe?.start_param;
    if (startParam) {
      navigate(`/movie/${startParam}`, { replace: true });
    }
  }, [navigate]);

  return null;
}

import { VIP_USERS } from './config/vipUsers';

function BottomNav() {
  const location = useLocation();
  const { t } = useLanguage();
  
  // Hide on video player pages
  if (location.pathname.includes('/movie/') || location.pathname.includes('/adult/')) return null;

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 flex justify-around p-3 border-t backdrop-blur-md z-40"
      style={{ 
        backgroundColor: 'var(--bg-color)', 
        borderColor: 'var(--hint-color)' 
      }}
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

import { ThemeProvider } from './context/ThemeContext';

export default function App() {
  useEffect(() => {
    WebApp.ready();
    
    // Auto-grant VIP to users in the VIP list
    const user = WebApp.initDataUnsafe?.user;
    if (user?.username && VIP_USERS.includes(user.username)) {
      localStorage.setItem('vip_until', 'lifetime');
      localStorage.setItem('age_confirmed', 'true');
    }
  }, []);

  return (
    <ThemeProvider>
      <AudioPlayerProvider>
        <BrowserRouter>
          <DeepLinkHandler />
          <div className="pb-16 min-h-screen relative">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/movies" element={<Home />} />
              <Route path="/radio-tv" element={<RadioTV />} />
              <Route path="/movie/:id" element={<Movie />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/favorites" element={<Favorites />} />
              <Route path="/adult" element={<Adult />} />
              <Route path="/adult/:id" element={<AdultVideo />} />
            </Routes>
          </div>
          <GlobalAudioPlayer />
          <BottomNav />
        </BrowserRouter>
      </AudioPlayerProvider>
    </ThemeProvider>
  );
}
