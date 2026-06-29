import React, { createContext, useContext, useState } from 'react';
import { WebApp } from '../telegram';

export type Language = 'ru-RU' | 'en-US' | 'ko-KR' | 'id-ID' | 'hi-IN' | 'fa-IR';

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
    privateModeDesc: 'Эксклюзивный контент для взрослых. Доступен только VIP подписчикам.',
    privateBotTitle: 'Приватный 18+ Бот',
    open18Bot: 'Открыть 18+ Бота',
    buyVipForAccess: 'Купить VIP для доступа',
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
    tgLoginRequired: 'Для доступа к Приват-разделу необходимо авторизоваться через Telegram',
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
    supportCreator: 'Поддержать автора',
    supportSubtitle: 'Крипто-перевод (USDT / TON)',
    tvWarning: 'Внимание: некоторые каналы могут не работать из-за геоблокировок или отключения серверов поставщика. Если канал не работает — просто выберите другой.',
    source1: 'Источник 1',
    source2: 'Источник 2',
    source3: 'Источник 3',
    supportContact: 'Написать разработчику',
    supportContactSubtitle: 'Связь с техподдержкой'
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
    privateModeDesc: 'Exclusive adult content. Available only for VIP subscribers.',
    privateBotTitle: 'Private 18+ Bot',
    open18Bot: 'Open 18+ Bot',
    buyVipForAccess: 'Buy VIP for access',
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
    tgLoginRequired: 'You need to log in via Telegram to access the Private section',
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
    supportSubtitle: 'Crypto Transfer (USDT / TON)',
    tvWarning: 'Note: some channels might not work due to geo-blocks or offline provider servers. If a channel doesn\'t load, just try another one.',
    source1: 'Source 1',
    source2: 'Source 2',
    source3: 'Source 3',
    supportContact: 'Contact Developer',
    supportContactSubtitle: 'Contact tech support'
  }
};

// Auto-fill missing translations with English for new languages
const enBase = translations['en-US'];

const extendedTranslations = {
  ...translations,
  'ko-KR': { ...enBase, movies: '영화', series: '시리즈', home: '홈', profile: '프로필', searchPlaceholder: '검색...', watch: '시청하기', language: '언어', radio_and_tv: '라디오 및 TV' },
  'id-ID': { ...enBase, movies: 'Film', series: 'Serial', home: 'Beranda', profile: 'Profil', searchPlaceholder: 'Cari...', watch: 'Tonton', language: 'Bahasa', radio_and_tv: 'Radio & TV' },
  'hi-IN': { ...enBase, movies: 'फिल्में', series: 'सीरीज़', home: 'होम', profile: 'प्रोफ़ाइल', searchPlaceholder: 'खोजें...', watch: 'देखें', language: 'भाषा', radio_and_tv: 'रेडियो और टीवी' },
  'fa-IR': { ...enBase, movies: 'فیلم‌ها', series: 'سریال‌ها', home: 'خانه', profile: 'پروفایل', searchPlaceholder: 'جستجو...', watch: 'تماشا', language: 'زبان', radio_and_tv: 'رادیو و تلویزیون' },
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
      if (saved && extendedTranslations[saved]) return saved;

      const tgLang = WebApp.initDataUnsafe?.user?.language_code;
      if (tgLang === 'ru') return 'ru-RU';
      if (tgLang === 'ko') return 'ko-KR';
      if (tgLang === 'id') return 'id-ID';
      if (tgLang === 'hi') return 'hi-IN';
      if (tgLang === 'fa') return 'fa-IR';
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
    return (extendedTranslations as any)[language]?.[key] || translations['ru-RU'][key];
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

