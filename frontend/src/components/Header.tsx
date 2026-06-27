import { useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';

export function Header({ title = "MovieManiak" }: { title?: string }) {
  const navigate = useNavigate();
  const user = WebApp.initDataUnsafe?.user;

  return (
    <div className="flex justify-between items-center mb-6 mt-2">
      <h1 
        className="text-2xl font-extrabold tracking-tight cursor-pointer active:scale-95 transition-transform flex items-center gap-2"
        onClick={() => navigate('/')}
      >
        {title}
      </h1>
      <button 
        onClick={() => navigate('/profile')}
        className="w-10 h-10 rounded-full overflow-hidden border-2 transition-transform active:scale-95 shadow-sm flex items-center justify-center bg-[var(--hint-color)]"
        style={{ borderColor: 'var(--button-color)', color: 'var(--text-color)' }}
      >
        {user?.photo_url ? (
          <img src={user.photo_url} alt="Profile" className="w-full h-full object-cover" />
        ) : (
          <span className="font-bold">{user?.first_name?.[0] || '👤'}</span>
        )}
      </button>
    </div>
  );
}
