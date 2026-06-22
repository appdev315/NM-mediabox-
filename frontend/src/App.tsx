import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { WebApp } from './telegram';
import { useLanguage } from './context/LanguageContext';

import { Home } from './pages/Home';
import { Movie } from './pages/Movie';
import { Profile } from './pages/Profile';

function BottomNav() {
  const location = useLocation();
  const { t } = useLanguage();
  
  if (location.pathname.includes('/movie/')) return null;

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 flex justify-around p-3 border-t backdrop-blur-md"
      style={{ 
        backgroundColor: 'var(--bg-color)', 
        borderColor: 'var(--hint-color)' 
      }}
    >
      <Link 
        to="/" 
        className={`font-bold transition-opacity ${location.pathname === '/' ? 'opacity-100' : 'opacity-50'}`}
        style={{ color: 'var(--button-color)' }}
      >
        {t('home')}
      </Link>
      <Link 
        to="/profile" 
        className={`font-bold transition-opacity ${location.pathname === '/profile' ? 'opacity-100' : 'opacity-50'}`}
        style={{ color: 'var(--button-color)' }}
      >
        {t('profile')}
      </Link>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    WebApp.ready();
  }, []);

  return (
    <BrowserRouter>
      <div className="pb-16 min-h-screen">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/movie/:id" element={<Movie />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>
      <BottomNav />
    </BrowserRouter>
  );
}
