import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

type Theme = 'auto' | 'light' | 'dark';

interface ThemeContextProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('app_theme') as Theme) || 'auto';
  });

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      root.classList.remove('theme-light', 'theme-dark', 'dark');

      let effectiveTheme = theme;
      if (theme === 'auto') {
        effectiveTheme = mediaQuery.matches ? 'dark' : 'light';
      }

      if (effectiveTheme === 'light') {
        root.classList.add('theme-light');
      } else {
        root.classList.add('theme-dark', 'dark');
      }
    };

    applyTheme();

    if (theme === 'auto') {
      const mq = mediaQuery as any;
      // WebKit < 14: у MediaQueryList нет addEventListener — фолбэк на addListener
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', applyTheme);
        return () => mq.removeEventListener('change', applyTheme);
      }
      if (typeof mq.addListener === 'function') {
        mq.addListener(applyTheme);
        return () => mq.removeListener(applyTheme);
      }
      return undefined;
    }
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('app_theme', newTheme);
    } catch (_) {}
  }, []);

  const value = useMemo(() => ({
    theme,
    setTheme
  }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
