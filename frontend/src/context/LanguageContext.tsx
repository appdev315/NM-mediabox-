import React, { createContext, useContext, useState } from 'react';

type Language = 'ru-RU' | 'en-US';

export const translations = {
  'ru-RU': {
    movies: 'Фильмы',
    series: 'Сериалы',
    searchPlaceholder: 'Поиск фильмов и сериалов...',
    allGenres: 'Все жанры',
    loadMore: 'Загрузить еще',
    home: 'Главная',
    profile: 'Профиль',
    watch: 'Смотреть',
    recommendations: 'Рекомендуем также',
    loading: 'Загрузка...',
    notFound: 'Ничего не найдено',
    movieNotFound: 'Фильм не найден',
    descriptionMissing: 'Описание отсутствует.'
  },
  'en-US': {
    movies: 'Movies',
    series: 'TV Shows',
    searchPlaceholder: 'Search movies and TV shows...',
    allGenres: 'All genres',
    loadMore: 'Load more',
    home: 'Home',
    profile: 'Profile',
    watch: 'Watch',
    recommendations: 'Recommendations',
    loading: 'Loading...',
    notFound: 'Nothing found',
    movieNotFound: 'Movie not found',
    descriptionMissing: 'No description available.'
  }
};

type TranslationKey = keyof typeof translations['ru-RU'];

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('ru-RU');

  const t = (key: TranslationKey) => {
    return translations[language][key] || translations['ru-RU'][key];
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
