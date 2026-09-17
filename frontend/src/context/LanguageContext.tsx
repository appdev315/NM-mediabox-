import React, { createContext, useContext, useState } from 'react';
import { WebApp } from '../telegram';

export type Language = 'ru-RU' | 'en-US' | 'de-DE' | 'es-ES' | 'fr-FR';

export const LANGUAGES_CONFIG: { code: Language; flag: string; label: string; name: string; fullName: string }[] = [
  { code: 'ru-RU', flag: '🇷🇺', label: 'RU', name: 'Русский', fullName: 'Русский' },
  { code: 'en-US', flag: '🇺🇸', label: 'EN', name: 'English', fullName: 'English' },
  { code: 'de-DE', flag: '🇩🇪', label: 'DE', name: 'Deutsch', fullName: 'Deutsch' },
  { code: 'es-ES', flag: '🇪🇸', label: 'ES', name: 'Español', fullName: 'Español' },
  { code: 'fr-FR', flag: '🇫🇷', label: 'FR', name: 'Français', fullName: 'Français' },
];

export const translations = {
  'ru-RU': {"iosInstallTitle": "Установка на iPhone и iPad", "iosStep1": "В браузере Safari нажмите кнопку «Поделиться» (иконка со стрелкой вверх внизу)", "iosStep2": "Прокрутите список вниз и выберите «На экран «Домой»»", "iosStep3": "В правом верхнем углу нажмите «Добавить»", "gotIt": "Понятно", "bannerMainBot": "Бесплатное кино прямо в твоем телеграмм", "bannerTelegram": "Тайная комната в тг", "bannerAdult": "Секретный раздел 18+", "secretRoomTab": "Тайная комната 🍓", "secretRoomRulesTitle": "3 правила Тайной Комнаты:", "secretRoomRule1": "1. Первое правило тайной комнаты — никому не рассказывать про тайную комнату.", "secretRoomRule2": "2. Второе правило тайной комнаты — никому не рассказывать про первое правило тайной комнаты.", "secretRoomRule3": "3. Третье правило тайной комнаты — обещаю подписаться на тг бота )", "secretRoomWarning": "Нажимая «Подтверждаю», вы подтверждаете, что вам исполнилось 18 лет, и берёте на себя полную ответственность за просмотр взрослого контента. Вы обязуетесь не распространять данный контент среди несовершеннолетних.", "secretRoomConfirm": "✅ Подтверждаю", "secretRoomLeave": "❌ Покинуть страницу", 
  "movies": "Фильмы",
  "series": "Сериалы",
  "search": "Поиск",
  "searchBtn": "Найти",
  "searchPlaceholder": "Поиск фильмов и сериалов...",
  "allGenres": "Все жанры",
  "allCountries": "Все страны",
  "loadMore": "Загрузить еще",
  "showMore": "Показать еще",
  "downloadsTab": "Скачать",
  "home": "Главная",
  "profile": "Профиль",
  "settings": "Настройки",
  "watch": "Смотреть",
  "recommendations": "Рекомендуем также",
  "loading": "Загрузка...",
  "notFound": "Ничего не найдено",
  "movieNotFound": "Фильм не найден",
  "descriptionMissing": "Описание отсутствует.",
  "myFavorites": "История",
  "emptyFavorites": "Тут пока пусто 🎬",
  "vipStatus": "VIP Статус",
  "buyLifetime": "Купить Навсегда",
  "buyLifetimeSub": "Разовый платеж для бесконечного просмотра",
  "vipActive": "VIP активен до",
  "lifetimeActive": "VIP Навсегда активен",
  "privateModeTitle": "Раздел Private 🍓",
  "privateModeDesc": "Эксклюзивный контент без цензуры в Telegram.",
  "privateBotTitle": "Приватный VIP Клуб",
  "open18Bot": "Смотреть 18+ в Telegram", "mainBotTitle": "Смотреть в Telegram", "mainBotDesc": "Смотрите новинки кино и сериалов бесплатно и без ограничений.", "openMainBot": "Перейти в Telegram",
  "buyVipForAccess": "Купить VIP для доступа",
  "privateCollection": "Private Collection",
  "privateCollectionDesc": "Приватная коллекция премиум-контента. Доступно только для VIP-пользователей.",
  "unlockWithStars": "Разблокировать за Telegram Stars",
  "language": "Язык",
  "theme": "Тема",
  "themeAuto": "Авто",
  "themeLight": "Светлая",
  "themeDark": "Темная",
  "searchPlaceholderRadio": "Поиск...",
  "back": "Назад",
  "vipRequired": "Требуется VIP",
  "vipRequiredDesc": "Этот контент доступен только VIP-пользователям",
  "openBot": "Открыть бота",
  "movies_and_series": "Кино",
  "radio_and_tv": "Радио",
  "privateContent": "Private",
  "favorites": "Избранное",
  "subtitle_movies": "Фильмы и сериалы без рекламы",
  "subtitle_radio": "Прямые эфиры и станции",
  "subtitle_adult": "Эксклюзивная 18+ коллекция",
  "tgLoginRequired": "Для доступа к Приват-разделу необходимо авторизоваться через Telegram",
  "tab_movies": "Фильмы",
  "tab_series": "Сериалы",
  "tab_radio": "Радио",
  "tab_tv": "ТВ",
  "tab_private": "Private",
  "emptyList": "Список пуст",
  "comingSoon": "Скоро...",
  "player1": "Плеер 1",
  "player2": "Плеер 2",
  "player3": "Плеер 3",
  "player": "Плеер",
  "episode": "Серия",
  "seasonsAndEpisodes": "Сезоны и серии",
  "season": "Сезон",
  "buyVip": "Купить VIP ⭐️",
  "supportCreator": "Поддержать автора",
  "supportSubtitle": "Крипто-перевод (USDT / TON)",
  "tvWarning": "Внимание: некоторые каналы могут не работать из-за геоблокировок или отключения серверов поставщика.",
  "source1": "Источник 1",
  "source2": "Источник 2",
  "source3": "Источник 3",
  "supportContact": "Написать разработчику",
  "supportContactSubtitle": "Связь с техподдержкой",
  "menu": "Меню",
  "supportProject": "Поддержать проект",
  "scanQr": "Сканируйте QR или скопируйте адрес ниже",
  "copy": "Копировать",
  "addressCopied": "Адрес скопирован в буфер обмена!",
  "close": "Закрыть", "downloadAndroid": "Скачать MediaBox на Android", "downloadIos": "Скачать MediaBox iOS", "mediaBoxTelegram": "MediaBox в Telegram", "iosInstallPrompt": "Чтобы установить MediaBox на iPhone/iPad: нажмите кнопку «Поделиться» (квадрат со стрелочкой вверх внизу Safari) и выберите «На экран Домой».", "cancelPrompt": "Если появится запрос \"Открыть ссылку\", нажмите \"Отмена\".",
  "clearHistory": "Очистить всю историю", "confirmClearHistory": "Вы уверены, что хотите очистить всю историю?",
  "clearFavorites": "Очистить избранное", "confirmClearFavorites": "Вы уверены, что хотите очистить всё избранное?", "emptyHistory": "История просмотров пуста", "addToFavorites": "В избранное", "removeFromFavorites": "Удалить из избранного", "history": "История",
  "overview": "Обзор", "playTrailer": "Воспроизвести трейлер", "tmdbRating": "Зрительский рейтинг", "topImdb": "⭐ Top IMDb", "topCast": "В главных ролях", "director": "Режиссер", "writer": "Сценарист", "trailer": "Трейлер", "dateOfBirth": "Дата рождения", "placeOfBirth": "Место рождения", "actingMastery": "Исполнительное мастерство", "popularProfile": "Популярный профиль", "biography": "Биография", "knownFor": "Известность за", "infoMissing": "Информация отсутствует",
  "contentUnavailable": "Контент временно недоступен", "contentUnavailableDesc": "Фильм не найден на доступных источниках. Попробуйте позже или выберите другой фильм.", "retry": "Повторить",
  "reportToDev": "Отправить уведомление разработчику", "reportSending": "Отправка...", "reportSent": "Уведомление отправлено разработчику", "chooseAnother": "Выбрать другой фильм",
  "unreleasedMovie": "Фильм ещё не вышел в кинотеатрах", "premiereDate": "Премьера", "watchTrailerOfficial": "Смотреть трейлер", "inProductionDesc": "Фильм находится на стадии производства. Официальный трейлер доступен ниже.",
  "trailersTab": "Что глянуть?", "watchMovie": "Смотреть фильм", "watchSeries": "Смотреть сериал", "trailerSoundOn": "Звук", "trailerSoundOff": "Без звука", "audioLanguageHint": "Переключи язык аудио здесь", "nextTrailer": "Следующий", "prevTrailer": "Предыдущий", "watchAll": "Смотреть все", "moreMovies": "Больше фильмов", "showLess": "Свернуть", "clickToHide": "Нажмите, чтобы скрыть", "removeFromHistory": "Удалить из истории", "offlineBanner": "📡 Соединение частично отсутствует — используется локальный кэш", "trending": "Популярное", "backToCatalog": "В каталог", "returnToList": "← Вернуться к списку", "categoryBadge": "Категория", "allCategories": "Все категории", "popularCategory": "Популярное", "adultCategory": "18+", "moreOnAdultSite": "Ещё больше на сайте 18+", "thousandsAdultVideos": "Тысячи эксклюзивных роликов", "goToSite": "Перейти →", "securePlaybackNotice": "Воспроизведение защищено. Запись экрана может быть заблокирована системой устройства.", "videoNotFound": "Видео не найдено или удалено", "loadingVideo": "Загрузка видео...", "openBanner": "Перейти", "adBadge": "Реклама", "adWordMovies": "ФИЛЬМЫ", "adWordSeries": "СЕРИАЛЫ", "adWordEverywhere": "ВЕЗДЕ", "step1": "1. Шаг 1", "step2": "2. Шаг 2", "step3": "3. Шаг 3"},
  'en-US': {"iosInstallTitle": "Install on iPhone & iPad", "iosStep1": "In Safari, tap the Share button (box with arrow up) at the bottom", "iosStep2": "Scroll down and select \"Add to Home Screen\"", "iosStep3": "Tap \"Add\" in the top right corner", "gotIt": "Got it", "bannerMainBot": "Free movies right in your telegram", "bannerTelegram": "Secret room in tg", "bannerAdult": "Secret 18+ Section", "secretRoomTab": "Secret Room 🍓", "secretRoomRulesTitle": "3 Rules of the Secret Room:", "secretRoomRule1": "1. The first rule of the secret room — do not tell anyone about the secret room.", "secretRoomRule2": "2. The second rule of the secret room — do not tell anyone about the first rule of the secret room.", "secretRoomRule3": "3. The third rule of the secret room — I promise to subscribe to the TG bot )", "secretRoomWarning": "By clicking 'I Confirm', you acknowledge that you are at least 18 years of age and take full legal responsibility for viewing adult content. You agree not to distribute this content to minors.", "secretRoomConfirm": "✅ I Confirm", "secretRoomLeave": "❌ Leave Page", 
  "movies": "Movies",
  "series": "TV Shows",
  "search": "Search",
  "searchBtn": "Search",
  "searchPlaceholder": "Search movies and TV shows...",
  "allGenres": "All genres",
  "allCountries": "All countries",
  "loadMore": "Load more",
  "showMore": "Show more",
  "downloadsTab": "Download",
  "home": "Home",
  "profile": "Profile",
  "settings": "Settings",
  "watch": "Watch",
  "recommendations": "Recommendations",
  "loading": "Loading...",
  "notFound": "Nothing found",
  "movieNotFound": "Movie not found",
  "descriptionMissing": "No description available.",
  "myFavorites": "History",
  "emptyFavorites": "It is empty here so far 🎬",
  "vipStatus": "VIP Status",
  "buyLifetime": "Buy Lifetime",
  "buyLifetimeSub": "One-time payment for endless streaming",
  "vipActive": "VIP active until",
  "lifetimeActive": "Lifetime VIP active",
  "privateModeTitle": "Private 🍓 Section",
  "privateModeDesc": "Exclusive uncensored content in Telegram.",
  "privateBotTitle": "Private VIP Club",
  "open18Bot": "Watch 18+ in Telegram", "mainBotTitle": "Watch in Telegram", "mainBotDesc": "Watch new movies and series for free without limits.", "openMainBot": "Open in Telegram",
  "buyVipForAccess": "Buy VIP for access",
  "privateCollection": "Private Collection",
  "privateCollectionDesc": "Private collection of premium content. Available only for VIP members.",
  "unlockWithStars": "Unlock with Telegram Stars",
  "language": "Language",
  "theme": "Theme",
  "themeAuto": "Auto",
  "themeLight": "Light",
  "themeDark": "Dark",
  "searchPlaceholderRadio": "Search...",
  "back": "Back",
  "vipRequired": "VIP Required",
  "vipRequiredDesc": "This content is for VIP only",
  "openBot": "Open Bot",
  "movies_and_series": "Movies",
  "radio_and_tv": "Radio",
  "privateContent": "Private",
  "favorites": "Favorites",
  "subtitle_movies": "Movies & series, ad-free",
  "subtitle_radio": "Live streams and stations",
  "subtitle_adult": "Exclusive 18+ collection",
  "tgLoginRequired": "You need to log in via Telegram to access the Private section",
  "tab_movies": "Movies",
  "tab_series": "Series",
  "tab_radio": "Radio",
  "tab_tv": "TV",
  "tab_private": "Private",
  "emptyList": "List is empty",
  "comingSoon": "Coming Soon...",
  "player1": "Player 1",
  "player2": "Player 2",
  "player3": "Player 3",
  "player": "Player",
  "episode": "Episode",
  "seasonsAndEpisodes": "Seasons and Episodes",
  "season": "Season",
  "buyVip": "Buy VIP ⭐️",
  "supportCreator": "Support Creator",
  "supportSubtitle": "Crypto Transfer (USDT / TON)",
  "tvWarning": "Note: some channels might not work due to geo-blocks or offline provider servers.",
  "source1": "Source 1",
  "source2": "Source 2",
  "source3": "Source 3",
  "supportContact": "Contact Developer",
  "supportContactSubtitle": "Contact tech support",
  "menu": "Menu",
  "supportProject": "Support Project",
  "scanQr": "Scan QR or copy address below",
  "copy": "Copy",
  "addressCopied": "Address copied to clipboard!",
  "close": "Close",
  "downloadAndroid": "Download MediaBox for Android",
  "downloadIos": "Download MediaBox iOS",
  "mediaBoxTelegram": "MediaBox on Telegram",
  "iosInstallPrompt": "To install MediaBox on iPhone/iPad: tap 'Share' (box with arrow up at bottom of Safari) and select 'Add to Home Screen'.",
  "cancelPrompt": "If prompted with \"Open link\", tap \"Cancel\".",
  "clearHistory": "Clear all history",
  "confirmClearHistory": "Are you sure you want to clear all history?",
  "clearFavorites": "Clear favorites",
  "confirmClearFavorites": "Are you sure you want to clear all favorites?",
  "emptyHistory": "Viewing history is empty",
  "addToFavorites": "Add to favorites",
  "removeFromFavorites": "Remove from favorites",
  "history": "History",
  "overview": "Overview",
  "playTrailer": "Play trailer",
  "tmdbRating": "Audience rating",
  "topImdb": "⭐ Top IMDb",
  "topCast": "Top Cast",
  "director": "Director",
  "writer": "Writer",
  "trailer": "Trailer",
  "dateOfBirth": "Date of birth",
  "placeOfBirth": "Place of birth",
  "actingMastery": "Acting mastery",
  "popularProfile": "Popular profile",
  "biography": "Biography",
  "knownFor": "Known for",
  "infoMissing": "Information missing",
  "contentUnavailable": "Content temporarily unavailable",
  "contentUnavailableDesc": "Movie not found on available sources. Try again later or choose another movie.",
  "retry": "Retry",
  "reportToDev": "Send report to developer",
  "reportSending": "Sending...",
  "reportSent": "Report sent to developer",
  "chooseAnother": "Choose another movie",
  "unreleasedMovie": "Movie not released in theaters yet",
  "premiereDate": "Premiere",
  "watchTrailerOfficial": "Watch trailer",
  "inProductionDesc": "Movie is currently in production. Official trailer is available below.",
  "trailersTab": "What to watch?",
  "watchMovie": "Watch movie",
  "watchSeries": "Watch TV show",
  "trailerSoundOn": "Sound",
  "trailerSoundOff": "Mute",
  "audioLanguageHint": "Switch audio language here",
  "nextTrailer": "Next",
  "prevTrailer": "Previous",
  "watchAll": "Watch all",
  "moreMovies": "More movies",
  "showLess": "Collapse",
  "clickToHide": "Click to hide",
  "removeFromHistory": "Remove from history",
  "offlineBanner": "📡 Connection partially lost — using local cache",
  "trending": "Trending",
  "backToCatalog": "Back to catalog",
  "returnToList": "← Back to list",
  "categoryBadge": "Category",
  "allCategories": "All categories",
  "popularCategory": "Popular",
  "adultCategory": "18+",
  "moreOnAdultSite": "More on 18+ site",
  "thousandsAdultVideos": "Thousands of exclusive videos",
  "goToSite": "Go to site →",
  "securePlaybackNotice": "Playback is protected. Screen recording may be blocked by your device.",
  "videoNotFound": "Video not found or removed",
  "loadingVideo": "Loading video...",
  "openBanner": "Open",
  "adBadge": "Ad",
  "adWordMovies": "MOVIES",
  "adWordSeries": "SERIES",
  "adWordEverywhere": "EVERYWHERE",
  "step1": "1. Step 1",
  "step2": "2. Step 2",
  "step3": "3. Step 3"
  }
};

export const extendedTranslations = {
  ...translations,
  'es-ES': {"settings": "Ajustes", "trailersTab": "¿Qué ver?", "watchMovie": "Ver película", "watchSeries": "Ver serie", "trailerSoundOn": "Sonido", "trailerSoundOff": "Sin sonido", "audioLanguageHint": "Cambiar idioma de audio aquí", "nextTrailer": "Siguiente", "prevTrailer": "Anterior", "iosInstallTitle": "Instalar en iPhone y iPad", "iosStep1": "En Safari, toca el botón Compartir (cuadrado con flecha) en la parte inferior", "iosStep2": "Desplázate hacia abajo y selecciona \"Añadir a pantalla de inicio\"", "iosStep3": "Toca \"Añadir\" en la esquina superior derecha", "gotIt": "Entendido", "iosInstallPrompt": "Para instalar MediaBox en iPhone/iPad: toca el botón 'Compartir' (cuadrado con flecha hacia arriba en la parte inferior de Safari) y selecciona 'Añadir a pantalla de inicio'.", "bannerMainBot": "Películas gratis directamente en tu telegram", "bannerTelegram": "Habitación secreta en tg", "bannerAdult": "Sección Secreta 18+", "secretRoomTab": "Habitación Secreta 🍓", "secretRoomRulesTitle": "3 Reglas de la Habitación Secreta:", "secretRoomRule1": "1. La primera regla de la habitación secreta — no le digas a nadie sobre la habitación secreta.", "secretRoomRule2": "2. La segunda regla de la habitación secreta — no le digas a nadie sobre la primera regla de la habitación secreta.", "secretRoomRule3": "3. La tercera regla de la habitación secreta — prometo suscribirme al bot de TG )", "secretRoomWarning": "Al hacer clic en 'Confirmo', reconoces que tienes al menos 18 años y asumes toda la responsabilidad legal por ver contenido para adultos. Aceptas no distribuir este contenido a menores.", "secretRoomConfirm": "✅ Confirmo", "secretRoomLeave": "❌ Salir de la página", "movies": "Películas", "series": "Series de TV", "search": "Buscar", "searchBtn": "Buscar", "allCountries": "Todos los países", "searchPlaceholder": "Buscar películas y series...", "allGenres": "Todos los géneros", "loadMore": "Cargar más", "showMore": "Ver más", "downloadsTab": "Descargar", "home": "Inicio", "profile": "Perfil", "watch": "Ver", "recommendations": "Recomendaciones", "loading": "Cargando...", "notFound": "No se encontró nada", "movieNotFound": "Película no encontrada", "descriptionMissing": "No hay descripción disponible.", "myFavorites": "Historial", "emptyFavorites": "Está vacío aquí por ahora 🎬", "vipStatus": "Estado VIP", "buyLifetime": "Comprar de por vida", "buyLifetimeSub": "Pago único para streaming sin fin", "vipActive": "VIP activo hasta", "lifetimeActive": "VIP de por vida activo", "privateModeTitle": "Sección Privada 🍓", "privateModeDesc": "Contenido exclusivo sin censura en Telegram.", "privateBotTitle": "Club VIP Privado", "open18Bot": "Ver 18+ en Telegram", "mainBotTitle": "Ver en Telegram", "mainBotDesc": "Mira nuevas películas y series gratis sin límites.", "openMainBot": "Abrir en Telegram", "buyVipForAccess": "Comprar VIP para acceder", "privateCollection": "Colección Privada", "privateCollectionDesc": "Colección privada de contenido premium. Disponible solo para miembros VIP.", "unlockWithStars": "Desbloquear con Telegram Stars", "language": "Idioma", "theme": "Tema", "themeAuto": "Automático", "themeLight": "Claro", "themeDark": "Oscuro", "searchPlaceholderRadio": "Buscar...", "back": "Volver", "vipRequired": "Requiere VIP", "vipRequiredDesc": "Este contenido es solo para VIP", "openBot": "Abrir Bot", "movies_and_series": "Películas", "radio_and_tv": "Radio", "privateContent": "Privado", "favorites": "Favoritos", "subtitle_movies": "Películas y series, sin anuncios", "subtitle_radio": "Transmisiones en vivo y estaciones", "subtitle_adult": "Colección exclusiva +18", "tgLoginRequired": "Debes iniciar sesión a través de Telegram para acceder a la section Privada", "tab_movies": "Películas", "tab_series": "Series", "tab_radio": "Radio", "tab_tv": "TV", "tab_private": "Privado", "emptyList": "La lista está vacía", "comingSoon": "Próximamente...", "player1": "Reproductor 1", "player2": "Reproductor 2", "player3": "Reproductor 3", "seasonsAndEpisodes": "Temporadas y episodios", "season": "Temporada", "buyVip": "Comprar VIP ⭐️", "supportCreator": "Apoyar al Creador", "supportSubtitle": "Transferencia Crypto (USDT / TON)", "tvWarning": "Nota: algunos canales pueden no funcionar debido a bloqueos geográficos o servidores de proveedores sin conexión. Si un canal no carga, intenta con otro.", "source1": "Fuente 1", "source2": "Fuente 2", "source3": "Fuente 3", "supportContact": "Contactar al desarrollador", "supportContactSubtitle": "Contactar a soporte técnico", "menu": "Menú", "supportProject": "Apoyar el Proyecto", "scanQr": "Escanea el código QR o copia la dirección a continuación", "copy": "Copiar", "addressCopied": "¡Dirección copiada al portapapeles!", "close": "Cerrar", "downloadAndroid": "Descargar MediaBox para Android", "downloadIos": "Descargar MediaBox iOS", "mediaBoxTelegram": "MediaBox en Telegram", "clearHistory": "Borrar todo el historial", "confirmClearHistory": "¿Estás seguro de que quieres borrar todo el historial?", "cancelPrompt": "Si aparece una ventana de \"Abrir enlace\", presione \"Cancelar\".", "watchAll": "Ver todo", "backToCatalog": "Al catálogo", "returnToList": "← Volver a la lista", "categoryBadge": "Categoría", "allCategories": "Todas las categorías", "popularCategory": "Popular", "trending": "Popular", "adultCategory": "18+", "moreOnAdultSite": "Más en el sitio 18+", "thousandsAdultVideos": "Miles de videos exclusivos", "goToSite": "Ir al sitio →", "securePlaybackNotice": "La reproducción está protegida. La grabación de pantalla puede ser bloqueada por tu dispositivo.", "videoNotFound": "Video no encontrado o eliminado", "loadingVideo": "Cargando video...", "openBanner": "Abrir", "adBadge": "Publicidad", "adWordMovies": "PELÍCULAS", "adWordSeries": "SERIES", "adWordEverywhere": "EN TODAS PARTES", "step1": "1. Paso 1", "step2": "2. Paso 2", "step3": "3. Paso 3", "topCast": "Reparto principal", "overview": "Descripción general", "director": "Director", "writer": "Guionista", "trailer": "Tráiler", "dateOfBirth": "Fecha de nacimiento", "placeOfBirth": "Lugar de nacimiento", "actingMastery": "Maestría actoral", "popularProfile": "Perfil popular", "biography": "Biografía", "knownFor": "Conocido por", "infoMissing": "Información no disponible", "contentUnavailable": "Contenido temporalmente no disponible", "contentUnavailableDesc": "Película no encontrada en las fuentes disponibles. Inténtelo más tarde.", "retry": "Reintentar", "reportToDev": "Enviar informe al desarrollador", "reportSending": "Enviando...", "reportSent": "Informe enviado al desarrollador", "chooseAnother": "Elegir otra película", "unreleasedMovie": "Película aún no estrenada en cines", "premiereDate": "Estreno", "watchTrailerOfficial": "Ver tráiler oficial", "inProductionDesc": "La película está en producción. El tráiler oficial estará disponible pronto.", "moreMovies": "Más películas", "showLess": "Colapsar", "clickToHide": "Toca para ocultar", "removeFromHistory": "Eliminar del historial", "offlineBanner": "📡 Conexión parcialmente perdida: usando caché local", "player": "Reproductor", "episode": "Episodio", "clearFavorites": "Borrar favoritos", "confirmClearFavorites": "¿Estás seguro de que quieres borrar todos los favoritos?", "emptyHistory": "El historial de visualización está vacío", "addToFavorites": "Añadir a favoritos", "removeFromFavorites": "Eliminar de favoritos", "history": "Historial", "playTrailer": "Reproducir tráiler", "tmdbRating": "Valoración de la audiencia", "topImdb": "⭐ Top IMDb"},
  'de-DE': {"settings": "Einstellungen", "trailersTab": "Was schauen?", "iosInstallTitle": "Auf iPhone & iPad installieren", "iosStep1": "Tippen Sie in Safari unten auf die Schaltfläche 'Teilen' (Quadrat mit Pfeil)", "iosStep2": "Scrollen Sie nach unten und wählen Sie 'Zum Home-Bildschirm'", "iosStep3": "Tippen Sie oben rechts auf 'Hinzufügen'", "gotIt": "Verstanden", "iosInstallPrompt": "So installieren Sie MediaBox auf dem iPhone/iPad: Tippen Sie auf die Schaltfläche 'Teilen' (Quadrat mit Pfeil nach oben unten in Safari) und wählen Sie 'Zum Home-Bildschirm'.", "bannerMainBot": "Kostenlose Filme direkt in deinem Telegram", "bannerTelegram": "Geheimer Raum in tg", "bannerAdult": "Geheimer 18+ Bereich", "secretRoomTab": "Geheimer Raum 🍓", "secretRoomRulesTitle": "3 Regeln des geheimen Raums:", "secretRoomRule1": "1. Die erste Regel des geheimen Raums — erzähle niemandem vom geheimen Raum.", "secretRoomRule2": "2. Die zweite Regel des geheimen Raum — erzähle niemandem von der ersten Regel des geheimen Raums.", "secretRoomRule3": "3. Die dritte Regel des geheimen Raums — ich verspreche, den TG-Bot zu abonnieren )", "secretRoomWarning": "Indem Sie auf 'Ich bestätige' klicken, bestätigen Sie, dass Sie mindestens 18 Jahre alt sind, und übernehmen die volle rechtliche Verantwortung für das Ansehen von Inhalten für Erwachsene. Sie stimmen zu, diese Inhalte nicht an Minderjährige weiterzugeben.", "secretRoomConfirm": "✅ Ich bestätige", "secretRoomLeave": "❌ Seite verlassen", "movies": "Filme", "series": "Serien", "search": "Suchen", "searchBtn": "Suchen", "allCountries": "Alle Länder", "searchPlaceholder": "Filme und Serien suchen...", "allGenres": "Alle Genres", "loadMore": "Mehr laden", "showMore": "Mehr anzeigen", "downloadsTab": "Download", "home": "Start", "profile": "Profil", "watch": "Ansehen", "recommendations": "Empfehlungen", "loading": "Wird geladen...", "notFound": "Nichts gefunden", "movieNotFound": "Film nicht gefunden", "descriptionMissing": "Keine Beschreibung verfügbar.", "myFavorites": "Verlauf", "emptyFavorites": "Hier ist es bisher leer 🎬", "vipStatus": "VIP Status", "buyLifetime": "Lifetime kaufen", "buyLifetimeSub": "Einmalige Zahlung für endloses Streaming", "vipActive": "VIP aktiv bis", "lifetimeActive": "Lifetime VIP aktiv", "privateModeTitle": "Privater Bereich 🍓", "privateModeDesc": "Exklusiver unzensierter Inhalt in Telegram.", "privateBotTitle": "Privater VIP-Club", "open18Bot": "18+ in Telegram ansehen", "mainBotTitle": "In Telegram ansehen", "mainBotDesc": "Sehen Sie neue Filme und Serien kostenlos ohne Grenzen.", "openMainBot": "In Telegram öffnen", "buyVipForAccess": "VIP für Zugang kaufen", "privateCollection": "Private Kollektion", "privateCollectionDesc": "Private Kollektion mit Premium-Inhalten. Nur für VIP-Mitglieder.", "unlockWithStars": "Mit Telegram Stars freischalten", "language": "Sprache", "theme": "Design", "themeAuto": "Auto", "themeLight": "Hell", "themeDark": "Dunkel", "searchPlaceholderRadio": "Suchen...", "back": "Zurück", "vipRequired": "VIP erforderlich", "vipRequiredDesc": "Dieser Inhalt ist nur für VIPs", "openBot": "Bot öffnen", "movies_and_series": "Filme", "radio_and_tv": "Radio", "privateContent": "Privat", "favorites": "Favoriten", "subtitle_movies": "Filme & Serien, werbefrei", "subtitle_radio": "Livestreams und Sender", "subtitle_adult": "Exklusive 18+ Kollektion", "tgLoginRequired": "Sie müssen sich über Telegram anmelden, um auf den privaten Bereich zuzugreifen", "tab_movies": "Filme", "tab_series": "Serien", "tab_radio": "Radio", "tab_tv": "TV", "tab_private": "Privat", "emptyList": "Liste ist leer", "comingSoon": "Demnächst...", "player1": "Player 1", "player2": "Player 2", "player3": "Player 3", "seasonsAndEpisodes": "Staffeln und Episoden", "season": "Staffel", "buyVip": "VIP kaufen ⭐️", "supportCreator": "Ersteller unterstützen", "supportSubtitle": "Krypto-Transfer (USDT / TON)", "tvWarning": "Hinweis: Einige Sender funktionieren möglicherweise aufgrund von Geoblocking oder Offline-Servern nicht. Wenn ein Sender nicht lädt, probieren Sie einen anderen.", "source1": "Quelle 1", "source2": "Quelle 2", "source3": "Quelle 3", "supportContact": "Entwickler kontaktieren", "supportContactSubtitle": "Technischen Support kontaktieren", "menu": "Menü", "supportProject": "Projekt unterstützen", "scanQr": "QR-Code scannen oder Adresse unten kopieren", "copy": "Kopieren", "addressCopied": "Adresse in die Zwischenablage kopiert!", "close": "Schließen", "downloadAndroid": "MediaBox für Android herunterladen", "downloadIos": "MediaBox iOS herunterladen", "mediaBoxTelegram": "MediaBox in Telegram", "clearHistory": "Gesamten Verlauf löschen", "confirmClearHistory": "Sind Sie sicher, dass Sie den gesamten Verlauf löschen möchten?", "cancelPrompt": "Wenn eine Meldung \"Link öffnen\" erscheint, drücken Sie \"Abbrechen\".", "watchAll": "Alle ansehen", "backToCatalog": "Zum Katalog", "returnToList": "← Zurück zur Liste", "categoryBadge": "Kategorie", "allCategories": "Alle Kategorien", "popularCategory": "Beliebt", "trending": "Beliebt", "adultCategory": "18+", "moreOnAdultSite": "Mehr auf der 18+ Website", "thousandsAdultVideos": "Tausende exklusive Videos", "goToSite": "Zur Website →", "securePlaybackNotice": "Die Wiedergabe ist geschützt. Bildschirmaufnahmen können vom Gerät blockiert werden.", "videoNotFound": "Video nicht gefunden oder entfernt", "loadingVideo": "Video wird geladen...", "openBanner": "Öffnen", "adBadge": "Werbung", "adWordMovies": "FILME", "adWordSeries": "SERIEN", "adWordEverywhere": "ÜBERALL", "watchMovie": "Film ansehen", "watchSeries": "Serie ansehen", "trailerSoundOn": "Ton an", "trailerSoundOff": "Stumm", "audioLanguageHint": "Audiosprache hier umschalten", "nextTrailer": "Nächster", "prevTrailer": "Vorheriger", "step1": "1. Schritt 1", "step2": "2. Schritt 2", "step3": "3. Schritt 3", "topCast": "Hauptbesetzung", "overview": "Übersicht", "director": "Regisseur", "writer": "Drehbuchautor", "trailer": "Trailer", "dateOfBirth": "Geburtsdatum", "placeOfBirth": "Geburtsort", "actingMastery": "Schauspielkunst", "popularProfile": "Beliebtes Profil", "biography": "Biografie", "knownFor": "Bekannt für", "infoMissing": "Keine Information verfügbar", "contentUnavailable": "Inhalt vorübergehend nicht verfügbar", "contentUnavailableDesc": "Film auf den verfügbaren Quellen nicht gefunden. Versuchen Sie es später erneut.", "retry": "Wiederholen", "reportToDev": "Bericht an Entwickler senden", "reportSending": "Wird gesendet...", "reportSent": "Bericht an Entwickler gesendet", "chooseAnother": "Anderen Film wählen", "unreleasedMovie": "Film noch nicht in den Kinos erschienen", "premiereDate": "Premiere", "watchTrailerOfficial": "Offiziellen Trailer ansehen", "inProductionDesc": "Der Film befindet sich in der Produktion. Der offizielle Trailer ist bald verfügbar.", "moreMovies": "Mehr Filme", "showLess": "Einklappen", "clickToHide": "Tippen zum Ausblenden", "removeFromHistory": "Aus dem Verlauf entfernen", "offlineBanner": "📡 Verbindung teilweise verloren – lokaler Cache wird verwendet", "player": "Player", "episode": "Episode", "clearFavorites": "Favoriten löschen", "confirmClearFavorites": "Möchten Sie wirklich alle Favoriten löschen?", "emptyHistory": "Wiedergabeverlauf ist leer", "addToFavorites": "Zu Favoriten hinzufügen", "removeFromFavorites": "Aus Favoriten entfernen", "history": "Verlauf", "playTrailer": "Trailer abspielen", "tmdbRating": "Zuschauerbewertung", "topImdb": "⭐ Top IMDb"},
  'fr-FR': {"settings": "Paramètres", "trailersTab": "Quoi regarder ?", "watchMovie": "Regarder le film", "watchSeries": "Regarder la série", "trailerSoundOn": "Son", "trailerSoundOff": "Sans son", "audioLanguageHint": "Changer la langue audio ici", "nextTrailer": "Suivant", "prevTrailer": "Précédent", "iosInstallTitle": "Installer sur iPhone et iPad", "iosStep1": "Dans Safari, appuyez sur le bouton Partager (carré avec flèche) en bas", "iosStep2": "Faites défiler vers le bas et sélectionnez « Sur l'écran d'accueil »", "iosStep3": "Appuyez sur « Ajouter » en haut à droite", "gotIt": "Compris", "iosInstallPrompt": "Pour installer MediaBox sur iPhone/iPad : appuyez sur le bouton 'Partager' (carré avec flèche vers le haut en bas de Safari) et sélectionnez 'Sur l'écran d'accueil'.", "bannerMainBot": "Des films gratuits directement dans votre telegram", "bannerTelegram": "Chambre secrète dans tg", "bannerAdult": "Section Secrète 18+", "secretRoomTab": "Chambre Secrète 🍓", "secretRoomRulesTitle": "3 Règles de la Chambre Secrète :", "secretRoomRule1": "1. La première règle de la chambre secrète — ne parlez à personne de la chambre secrète.", "secretRoomRule2": "2. La deuxième règle de la chambre secrète — ne parlez à personne de la première règle de la chambre secrète.", "secretRoomRule3": "3. La troisième règle de la chambre secrète — je promets de m'abonner au bot TG )", "secretRoomWarning": "En cliquant sur 'Je confirme', vous reconnaissez que vous avez au moins 18 ans et assumez l'entière responsabilité légale du visionnage de contenu pour adultes. Vous acceptez de ne pas distribuer ce contenu à des mineurs.", "secretRoomConfirm": "✅ Je confirme", "secretRoomLeave": "❌ Quitter la page", "movies": "Films", "series": "Séries", "search": "Rechercher", "searchBtn": "Rechercher", "allCountries": "Tous les pays", "searchPlaceholder": "Rechercher films et séries...", "allGenres": "Tous les genres", "loadMore": "Charger plus", "showMore": "Afficher plus", "downloadsTab": "Télécharger", "home": "Accueil", "profile": "Profil", "watch": "Regarder", "recommendations": "Recommandations", "loading": "Chargement...", "notFound": "Rien trouvé", "movieNotFound": "Film introuvable", "descriptionMissing": "Aucune description disponible.", "myFavorites": "Historique", "emptyFavorites": "C'est vide ici pour le moment 🎬", "vipStatus": "Statut VIP", "buyLifetime": "Acheter à vie", "buyLifetimeSub": "Paiement unique pour le streaming sans fin", "vipActive": "VIP actif jusqu'au", "lifetimeActive": "VIP à vie actif", "privateModeTitle": "Section Privée 🍓", "privateModeDesc": "Contenu exclusif non censuré sur Telegram.", "privateBotTitle": "Club VIP Privé", "open18Bot": "Regarder 18+ sur Telegram", "mainBotTitle": "Regarder sur Telegram", "mainBotDesc": "Regardez de nouveaux films et séries gratuitement sans limites.", "openMainBot": "Ouvrir sur Telegram", "buyVipForAccess": "Acheter VIP pour accéder", "privateCollection": "Collection Privée", "privateCollectionDesc": "Collection privée de contenu premium. Disponible uniquement pour les membres VIP.", "unlockWithStars": "Débloquer avec Telegram Stars", "language": "Langue", "theme": "Thème", "themeAuto": "Auto", "themeLight": "Clair", "themeDark": "Sombre", "searchPlaceholderRadio": "Rechercher...", "back": "Retour", "vipRequired": "VIP Requis", "vipRequiredDesc": "Ce contenu est réservé aux VIP", "openBot": "Ouvrir le Bot", "movies_and_series": "Films", "radio_and_tv": "Radio", "privateContent": "Privé", "favorites": "Favoris", "subtitle_movies": "Films & séries, sans publicité", "subtitle_radio": "Flux en direct et stations", "subtitle_adult": "Collection exclusive 18+", "tgLoginRequired": "Vous devez vous connecter via Telegram pour accéder à la section Privée", "tab_movies": "Films", "tab_series": "Séries", "tab_radio": "Radio", "tab_tv": "TV", "tab_private": "Privé", "emptyList": "La liste est vide", "comingSoon": "Bientôt...", "player1": "Lecteur 1", "player2": "Lecteur 2", "player3": "Lecteur 3", "seasonsAndEpisodes": "Saisons et épisodes", "season": "Saison", "buyVip": "Acheter VIP ⭐️", "supportCreator": "Soutenir le créateur", "supportSubtitle": "Transfert Crypto (USDT / TON)", "tvWarning": "Remarque : certaines chaînes peuvent ne pas fonctionner en raison de blocages géographiques ou de serveurs hors ligne. Si une chaîne ne se charge pas, essayez-en une autre.", "source1": "Source 1", "source2": "Source 2", "source3": "Source 3", "supportContact": "Contacter le développeur", "supportContactSubtitle": "Contacter l'assistance technique", "menu": "Menu", "supportProject": "Soutenir le projet", "scanQr": "Scannez le code QR ou copiez l'adresse ci-dessous", "copy": "Copier", "addressCopied": "Adresse copiée dans le presse-papiers !", "close": "Fermer", "downloadAndroid": "Télécharger MediaBox pour Android", "downloadIos": "Télécharger MediaBox iOS", "mediaBoxTelegram": "MediaBox sur Telegram", "clearHistory": "Effacer tout l'historique", "confirmClearHistory": "Êtes-vous sûr de vouloir effacer tout l'historique ?", "cancelPrompt": "Si un message demande \"Ouvrir le lien\", appuyez sur \"Annuler\".", "watchAll": "Tout voir", "backToCatalog": "Au catalogue", "returnToList": "← Retour à la liste", "categoryBadge": "Catégorie", "allCategories": "Toutes les catégories", "popularCategory": "Populaire", "trending": "Populaire", "adultCategory": "18+", "moreOnAdultSite": "Plus sur le site 18+", "thousandsAdultVideos": "Des milliers de vidéos exclusives", "goToSite": "Aller sur le site →", "securePlaybackNotice": "La lecture est sécurisée. L'enregistrement d'écran peut être bloqué par votre appareil.", "videoNotFound": "Vidéo non trouvée ou supprimée", "loadingVideo": "Chargement de la vidéo...", "openBanner": "Ouvrir", "adBadge": "Publicité", "adWordMovies": "FILMS", "adWordSeries": "SÉRIES", "adWordEverywhere": "PARTOUT", "step1": "1. Étape 1", "step2": "2. Étape 2", "step3": "3. Étape 3", "topCast": "Acteurs principaux", "overview": "Aperçu", "director": "Réalisateur", "writer": "Scénariste", "trailer": "Bande-annonce", "dateOfBirth": "Date de naissance", "placeOfBirth": "Lieu de naissance", "actingMastery": "Maîtrise d'acteur", "popularProfile": "Profil populaire", "biography": "Biographie", "knownFor": "Connu pour", "infoMissing": "Information non disponible", "contentUnavailable": "Contenu temporairement indisponible", "contentUnavailableDesc": "Film non trouvé sur les sources disponibles. Réessayez plus tard.", "retry": "Réessayer", "reportToDev": "Envoyer un rapport au développeur", "reportSending": "Envoi en cours...", "reportSent": "Rapport envoyé au développeur", "chooseAnother": "Choisir un autre film", "unreleasedMovie": "Film pas encore sorti au cinéma", "premiereDate": "Première", "watchTrailerOfficial": "Regarder la bande-annonce officielle", "inProductionDesc": "Le film est en cours de production. La bande-annonce officielle sera bientôt disponible.", "moreMovies": "Plus de films", "showLess": "Réduire", "clickToHide": "Appuyer pour masquer", "removeFromHistory": "Supprimer de l'historique", "offlineBanner": "📡 Connexion partiellement perdue — utilisation du cache local", "player": "Lecteur", "episode": "Épisode", "clearFavorites": "Effacer les favoris", "confirmClearFavorites": "Voulez-vous vraiment effacer tous les favoris ?", "emptyHistory": "L'historique de lecture est vide", "addToFavorites": "Ajouter aux favoris", "removeFromFavorites": "Supprimer des favoris", "history": "Historique", "playTrailer": "Lire la bande-annonce", "tmdbRating": "Note des spectateurs", "topImdb": "⭐ Top IMDb"}
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
      if (saved && (saved === 'ru-RU' || saved === 'en-US' || saved === 'de-DE' || saved === 'es-ES' || saved === 'fr-FR')) return saved;

      const tgLang = WebApp.initDataUnsafe?.user?.language_code;
      if (tgLang === 'ru') return 'ru-RU';
      if (tgLang === 'de') return 'de-DE';
      if (tgLang === 'es') return 'es-ES';
      if (tgLang === 'fr') return 'fr-FR';

      // Fallback for regular web browsers
      const browserLang = navigator.language || navigator.languages?.[0];
      if (browserLang) {
        if (browserLang.startsWith('ru')) return 'ru-RU';
        if (browserLang.startsWith('de')) return 'de-DE';
        if (browserLang.startsWith('es')) return 'es-ES';
        if (browserLang.startsWith('fr')) return 'fr-FR';
      }
    } catch (e) {
      console.error("Failed to get language", e);
    }
    return 'ru-RU';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_language', lang);
  };

  const t = (key: TranslationKey) => {
    const langDict = (extendedTranslations as any)[language];
    if (langDict && langDict[key]) return langDict[key];
    if (language !== 'ru-RU' && (translations['en-US'] as any)[key]) return (translations['en-US'] as any)[key];
    return translations['ru-RU'][key] || '';
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

export const getDefaultCountryForLanguage = (lang: Language): string => {
  switch (lang) {
    case 'ru-RU': return 'RU';
    case 'de-DE': return 'DE';
    case 'es-ES': return 'ES';
    case 'fr-FR': return 'FR';
    case 'en-US':
    default: return 'US';
  }
};

export const countriesList = [
  { code: 'US', flag: '🇺🇸', name: { 'ru-RU': 'США', 'en-US': 'USA', 'ko-KR': '미국', 'id-ID': 'Amerika Serikat', 'es-ES': 'Estados Unidos', 'de-DE': 'USA', 'fr-FR': 'États-Unis', 'hi-IN': 'अमेरिका', 'fa-IR': 'آمریکا', 'zh-CN': '美国' } },
  { code: 'RU', flag: '🇷🇺', name: { 'ru-RU': 'Россия', 'en-US': 'Russia', 'ko-KR': '러시아', 'id-ID': 'Rusia', 'es-ES': 'Rusia', 'de-DE': 'Russland', 'fr-FR': 'Russie', 'hi-IN': 'रूस', 'fa-IR': 'روسیه', 'zh-CN': '俄罗斯' } },
  { code: 'ID', flag: '🇮🇩', name: { 'ru-RU': 'Индонезия', 'en-US': 'Indonesia', 'ko-KR': '인도네시아', 'id-ID': 'Indonesia', 'es-ES': 'Indonesia', 'de-DE': 'Indonesien', 'fr-FR': 'Indonésie', 'hi-IN': 'इंडोनेशिया', 'fa-IR': 'اندونزی', 'zh-CN': '印度尼西亚' } },
  { code: 'KR', flag: '🇰🇷', name: { 'ru-RU': 'Южная Корея', 'en-US': 'South Korea', 'ko-KR': '대한민국', 'id-ID': 'Korea Selatan', 'es-ES': 'Corea del Sur', 'de-DE': 'Südkorea', 'fr-FR': 'Corée du Sud', 'hi-IN': 'दक्षिण कोरिया', 'fa-IR': 'کره جنوبی', 'zh-CN': '韩国' } },
  { code: 'JP', flag: '🇯🇵', name: { 'ru-RU': 'Япония', 'en-US': 'Japan', 'ko-KR': '일본', 'id-ID': 'Jepang', 'es-ES': 'Japón', 'de-DE': 'Japan', 'fr-FR': 'Japon', 'hi-IN': 'जापान', 'fa-IR': 'ژاپن', 'zh-CN': '日本' } },
  { code: 'FR', flag: '🇫🇷', name: { 'ru-RU': 'Франция', 'en-US': 'France', 'ko-KR': '프랑스', 'id-ID': 'Prancis', 'es-ES': 'Francia', 'de-DE': 'Frankreich', 'fr-FR': 'France', 'hi-IN': 'फ्रांस', 'fa-IR': 'فرانسه', 'zh-CN': '法国' } },
  { code: 'GB', flag: '🇬🇧', name: { 'ru-RU': 'Великобритания', 'en-US': 'United Kingdom', 'ko-KR': '영국', 'id-ID': 'Inggris', 'es-ES': 'Reino Unido', 'de-DE': 'Großbritannien', 'fr-FR': 'Royaume-Uni', 'hi-IN': 'ब्रिटेन', 'fa-IR': 'بریتانیا', 'zh-CN': '英国' } },
  { code: 'DE', flag: '🇩🇪', name: { 'ru-RU': 'Германия', 'en-US': 'Germany', 'ko-KR': '독일', 'id-ID': 'Jerman', 'es-ES': 'Alemania', 'de-DE': 'Deutschland', 'fr-FR': 'Allemagne', 'hi-IN': 'जर्मनी', 'fa-IR': 'آلمان', 'zh-CN': '德国' } },
  { code: 'IT', flag: '🇮🇹', name: { 'ru-RU': 'Италия', 'en-US': 'Italy', 'ko-KR': '이탈리아', 'id-ID': 'Italia', 'es-ES': 'Italia', 'de-DE': 'Italien', 'fr-FR': 'Italie', 'hi-IN': 'इटली', 'fa-IR': 'ایتالیا', 'zh-CN': '意大利' } },
  { code: 'CN', flag: '🇨🇳', name: { 'ru-RU': 'Китай', 'en-US': 'China', 'ko-KR': '중국', 'id-ID': 'Tiongkok', 'es-ES': 'China', 'de-DE': 'China', 'fr-FR': 'Chine', 'hi-IN': 'चीन', 'fa-IR': 'چین', 'zh-CN': '中国' } },
  { code: 'ES', flag: '🇪🇸', name: { 'ru-RU': 'Испания', 'en-US': 'Spain', 'ko-KR': '스페인', 'id-ID': 'Spanyol', 'es-ES': 'España', 'de-DE': 'Spanien', 'fr-FR': 'España', 'hi-IN': 'स्पेन', 'fa-IR': 'اسپانیا', 'zh-CN': '西班牙' } },
  { code: 'IN', flag: '🇮🇳', name: { 'ru-RU': 'Индия', 'en-US': 'India', 'ko-KR': '인도', 'id-ID': 'India', 'es-ES': 'India', 'de-DE': 'Indien', 'fr-FR': 'Inde', 'hi-IN': 'भारत', 'fa-IR': 'هند', 'zh-CN': '印度' } },
  { code: 'TR', flag: '🇹🇷', name: { 'ru-RU': 'Турция', 'en-US': 'Turkey', 'ko-KR': '튀르키예', 'id-ID': 'Turki', 'es-ES': 'Turquía', 'de-DE': 'Türkei', 'fr-FR': 'Turquie', 'hi-IN': 'तुर्की', 'fa-IR': 'ترکیه', 'zh-CN': '土耳其' } },
  { code: 'CA', flag: '🇨🇦', name: { 'ru-RU': 'Канада', 'en-US': 'Canada', 'ko-KR': '캐나다', 'id-ID': 'Kanada', 'es-ES': 'Canadá', 'de-DE': 'Kanada', 'fr-FR': 'Canada', 'hi-IN': 'कनाडा', 'fa-IR': 'کانادا', 'zh-CN': '加拿大' } },
  { code: 'AU', flag: '🇦🇺', name: { 'ru-RU': 'Австралия', 'en-US': 'Australia', 'ko-KR': '호주', 'id-ID': 'Australia', 'es-ES': 'Australia', 'de-DE': 'Australien', 'fr-FR': 'Australie', 'hi-IN': 'ऑस्ट्रेलिया', 'fa-IR': 'استرالیا', 'zh-CN': '澳大利亚' } }
];

