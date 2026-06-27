import React, { createContext, useContext, useState } from 'react';
import { WebApp } from '../telegram';

export type Language = 'ru-RU' | 'en-US';

export const translations = {
  'ru-RU': {
    movies: 'Фильмы',
    series: 'Сериалы',
    searchPlaceholder: 'Поиск фильмов и сериалов...',
    allGenres: 'Все жанры',
    loadMore: 'Загрузить еще',
    downloadsTab: 'Скачать',
    home: 'Главная',
    profile: 'Профиль',
    watch: 'Смотреть',
    recommendations: 'Рекомендуем также',
    loading: 'Загрузка...',
    notFound: 'Ничего не найдено',
    movieNotFound: 'Фильм не найден',
    descriptionMissing: 'Описание отсутствует.',
    myFavorites: 'Мое избранное',
    emptyFavorites: 'Тут пока пусто 🎬',
    vipStatus: 'VIP Статус',
    buyLifetime: 'Купить Навсегда',
    buyLifetimeSub: 'Разовый платеж для бесконечного просмотра',
    vipActive: 'VIP активен до',
    lifetimeActive: 'VIP Навсегда активен',
    privateModeTitle: 'Раздел Private 🍓',
    privateModeDesc: 'Скрыть или показать приватный контент',
    privateCollection: 'Private Collection',
    privateCollectionDesc: 'Приватная коллекция премиум-контента. Доступно только для VIP-пользователей.',
    unlockWithStars: 'Разблокировать за Telegram Stars',
    language: 'Язык',
    theme: 'Тема',
    themeAuto: 'Авто',
    themeLight: 'Светлая',
    themeDark: 'Темная',
    listenNow: 'Слушать',
    trendingNow: 'В тренде',
    thematicPlaylists: 'Подборки',
    topArtists: 'Топ Артисты',
    ambientSounds: 'Фоновые Звуки',
    ambientSoundsDesc: 'Бесконечный эмбиент — для сна, медитации, фокуса',
    searchPlaceholderMusic: 'Артисты, треки...',
    searchPlaceholderRadio: 'Поиск...',
    back: 'Назад',
    allTracksLoaded: 'Все треки загружены',
    vipRequired: 'Требуется VIP',
    vipRequiredDesc: 'Этот контент доступен только VIP-пользователям',
    openBot: 'Открыть бота',
    movies_and_series: 'Кино',
    radio_and_tv: 'Радио и ТВ',
    music: 'Музыка',
    privateContent: 'Private',
    favorites: 'Избранное',
    subtitle_movies: 'Фильмы и сериалы без рекламы',
    subtitle_radio: 'Прямые эфиры и станции',
    subtitle_music: 'Миллионы треков бесплатно',
    subtitle_adult: 'Эксклюзивная 18+ коллекция',
    tab_movies: 'Фильмы',
    tab_series: 'Сериалы',
    tab_radio: 'Радио',
    tab_tv: 'ТВ',
    tab_music: 'Музыка',
    tab_private: 'Private',
    emptyList: 'Список пуст',
    comingSoon: 'Скоро здесь будет...',
    player1: 'Плеер 1',
    player2: 'Плеер 2',
    buyVip: 'Купить VIP ⭐️',
    supportCreator: 'Поддержать создателя',
    supportSubtitle: 'Криптоперевод (USDT / TON)'
  },
  'en-US': {
    movies: 'Movies',
    series: 'TV Shows',
    searchPlaceholder: 'Search movies and TV shows...',
    allGenres: 'All genres',
    loadMore: 'Load more',
    downloadsTab: 'Download',
    home: 'Home',
    profile: 'Profile',
    watch: 'Watch',
    recommendations: 'Recommendations',
    loading: 'Loading...',
    notFound: 'Nothing found',
    movieNotFound: 'Movie not found',
    descriptionMissing: 'No description available.',
    myFavorites: 'My Favorites',
    emptyFavorites: 'It is empty here so far 🎬',
    vipStatus: 'VIP Status',
    buyLifetime: 'Buy Lifetime',
    buyLifetimeSub: 'One-time payment for endless streaming',
    vipActive: 'VIP active until',
    lifetimeActive: 'Lifetime VIP active',
    privateModeTitle: 'Private 🍓 Section',
    privateModeDesc: 'Show or hide the private content section',
    privateCollection: 'Private Collection',
    privateCollectionDesc: 'Private collection of premium content. Available only for VIP members.',
    unlockWithStars: 'Unlock with Telegram Stars',
    language: 'Language',
    theme: 'Theme',
    themeAuto: 'Auto',
    themeLight: 'Light',
    themeDark: 'Dark',
    listenNow: 'Listen Now',
    trendingNow: 'Trending Now',
    thematicPlaylists: 'Playlists',
    topArtists: 'Top Artists',
    ambientSounds: 'Ambient Sounds',
    ambientSoundsDesc: 'Endless ambient — for sleep, meditation, focus',
    searchPlaceholderMusic: 'Artists, tracks...',
    searchPlaceholderRadio: 'Search...',
    back: 'Back',
    allTracksLoaded: 'All tracks loaded',
    vipRequired: 'VIP Required',
    vipRequiredDesc: 'This content is for VIP only',
    openBot: 'Open Bot',
    movies_and_series: 'Movies',
    radio_and_tv: 'Radio & TV',
    music: 'Music',
    privateContent: 'Private',
    favorites: 'Favorites',
    subtitle_movies: 'Movies & series, ad-free',
    subtitle_radio: 'Live streams and stations',
    subtitle_music: 'Millions of tracks, ad-free',
    subtitle_adult: 'Exclusive 18+ collection',
    tab_movies: 'Movies',
    tab_series: 'Series',
    tab_radio: 'Radio',
    tab_tv: 'TV',
    tab_music: 'Music',
    tab_private: 'Private',
    emptyList: 'List is empty',
    comingSoon: 'Coming soon...',
    player1: 'Player 1',
    player2: 'Player 2',
    buyVip: 'Buy VIP ⭐️',
    supportCreator: 'Support Creator',
    supportSubtitle: 'Crypto Transfer (USDT / TON)'
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
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('app_language') as Language;
      if (saved && translations[saved]) return saved;

      const tgLang = WebApp.initDataUnsafe?.user?.language_code;
      if (tgLang === 'ru') return 'ru-RU';
    } catch (e) {
      console.error("Failed to get language", e);
    }
    return 'en-US';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_language', lang);
  };

  const t = (key: TranslationKey) => {
    return translations[language]?.[key] || translations['ru-RU'][key];
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

