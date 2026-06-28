import { useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';

export function Header() {
  const navigate = useNavigate();

  return (
    <button 
      onClick={() => navigate('/profile')}
      className="fixed bottom-24 right-4 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform active:scale-95 border"
      style={{ 
        backgroundColor: 'var(--bg-color)',
        borderColor: 'var(--button-color)', 
        color: 'var(--text-color)' 
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
