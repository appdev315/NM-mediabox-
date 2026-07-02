import React, { createContext, useContext, useState } from 'react';
import { WebApp } from '../telegram';

export type Language = 'ru-RU' | 'en-US' | 'ko-KR' | 'id-ID' | 'hi-IN' | 'fa-IR' | 'es-ES' | 'de-DE' | 'fr-FR';

export const translations = {
  'ru-RU': {"bannerMainBot": "Бесплатное кино в кармане", "bannerTelegram": "Смотреть без VPN в Telegram", "bannerAdult": "Секретный раздел 18+", "secretRoomTab": "Тайная комната 🍓", "secretRoomRulesTitle": "3 правила Тайной Комнаты:", "secretRoomRule1": "1. Первое правило тайной комнаты — никому не рассказывать про тайную комнату.", "secretRoomRule2": "2. Второе правило тайной комнаты — никому не рассказывать про первое правило тайной комнаты.", "secretRoomRule3": "3. Третье правило тайной комнаты — обещаю подписаться на тг бота )", "secretRoomWarning": "Нажимая «Подтверждаю», вы подтверждаете, что вам исполнилось 18 лет, и берёте на себя полную ответственность за просмотр взрослого контента. Вы обязуетесь не распространять данный контент среди несовершеннолетних.", "secretRoomConfirm": "✅ Подтверждаю", "secretRoomLeave": "❌ Покинуть страницу", 
  "movies": "Фильмы",
  "series": "Сериалы",
  "searchPlaceholder": "Поиск фильмов и сериалов...",
  "allGenres": "Все жанры",
  "loadMore": "Загрузить еще",
  "downloadsTab": "Скачать",
  "home": "Главная",
  "profile": "Профиль",
  "watch": "Смотреть",
  "recommendations": "Рекомендуем также",
  "loading": "Загрузка...",
  "notFound": "Ничего не найдено",
  "movieNotFound": "Фильм не найден",
  "descriptionMissing": "Описание отсутствует.",
  "myFavorites": "Мое избранное",
  "emptyFavorites": "Тут пока пусто 🎬",
  "vipStatus": "VIP Статус",
  "buyLifetime": "Купить Навсегда",
  "buyLifetimeSub": "Разовый платеж для бесконечного просмотра",
  "vipActive": "VIP активен до",
  "lifetimeActive": "VIP Навсегда активен",
  "privateModeTitle": "Раздел Private 🍓",
  "privateModeDesc": "Эксклюзивный контент без цензуры. Доступен только VIP подписчикам.",
  "privateBotTitle": "Приватный VIP Клуб",
  "open18Bot": "Открыть 18+ Бота", "mainBotTitle": "Основной Бот (Фильмы и ТВ)", "mainBotDesc": "Смотрите новинки кино и сериалов бесплатно и без ограничений.", "openMainBot": "Открыть Бота с Фильмами",
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
  "radio_and_tv": "Радио и ТВ",
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
  "comingSoon": "Скоро здесь будет...",
  "player1": "Плеер 1",
  "player2": "Плеер 2",
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
  "close": "Закрыть"
},
  'en-US': {"bannerMainBot": "Free cinema in your pocket", "bannerTelegram": "Watch without VPN in Telegram", "bannerAdult": "Secret 18+ Section", "secretRoomTab": "Secret Room 🍓", "secretRoomRulesTitle": "3 Rules of the Secret Room:", "secretRoomRule1": "1. The first rule of the secret room — do not tell anyone about the secret room.", "secretRoomRule2": "2. The second rule of the secret room — do not tell anyone about the first rule of the secret room.", "secretRoomRule3": "3. The third rule of the secret room — I promise to subscribe to the TG bot )", "secretRoomWarning": "By clicking 'I Confirm', you acknowledge that you are at least 18 years of age and take full legal responsibility for viewing adult content. You agree not to distribute this content to minors.", "secretRoomConfirm": "✅ I Confirm", "secretRoomLeave": "❌ Leave Page", 
  "movies": "Movies",
  "series": "TV Shows",
  "searchPlaceholder": "Search movies and TV shows...",
  "allGenres": "All genres",
  "loadMore": "Load more",
  "downloadsTab": "Download",
  "home": "Home",
  "profile": "Profile",
  "watch": "Watch",
  "recommendations": "Recommendations",
  "loading": "Loading...",
  "notFound": "Nothing found",
  "movieNotFound": "Movie not found",
  "descriptionMissing": "No description available.",
  "myFavorites": "My Favorites",
  "emptyFavorites": "It is empty here so far 🎬",
  "vipStatus": "VIP Status",
  "buyLifetime": "Buy Lifetime",
  "buyLifetimeSub": "One-time payment for endless streaming",
  "vipActive": "VIP active until",
  "lifetimeActive": "Lifetime VIP active",
  "privateModeTitle": "Private 🍓 Section",
  "privateModeDesc": "Exclusive adult content. Available only for VIP subscribers.",
  "privateBotTitle": "Private VIP Club",
  "open18Bot": "Open 18+ Bot", "mainBotTitle": "Main Bot (Movies & TV)", "mainBotDesc": "Watch new movies and series for free without limits.", "openMainBot": "Open Movie Bot",
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
  "radio_and_tv": "Radio & TV",
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
  "comingSoon": "Coming soon...",
  "player1": "Player 1",
  "player2": "Player 2",
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
  "scanQr": "Scan QR or copy the address below",
  "copy": "Copy",
  "addressCopied": "Address copied to clipboard!",
  "close": "Close"
}
};

// Auto-fill missing translations with English for new languages

export const extendedTranslations = {
  ...translations,
  'ko-KR': {"bannerMainBot": "주머니 속 무료 영화관", "bannerTelegram": "Telegram에서 VPN 없이 시청하기", "bannerAdult": "비밀 18+ 섹션", "secretRoomTab": "비밀의 방 🍓", "secretRoomRulesTitle": "비밀의 방의 3가지 규칙:", "secretRoomRule1": "1. 비밀의 방의 첫 번째 규칙 — 비밀의 방에 대해 아무에게도 말하지 마십시오.", "secretRoomRule2": "2. 비밀의 방의 두 번째 규칙 — 비밀의 방의 첫 번째 규칙에 대해 아무에게도 말하지 마십시오.", "secretRoomRule3": "3. 비밀의 방의 세 번째 규칙 — TG 봇을 구독할 것을 약속합니다 )", "secretRoomWarning": "'확인'을 클릭하면 귀하가 18세 이상임을 확인하고 성인 콘텐츠를 보는 데 대한 모든 법적 책임을 지게 됩니다. 이 콘텐츠를 미성년자에게 배포하지 않을 것에 동의합니다.", "secretRoomConfirm": "✅ 확인합니다", "secretRoomLeave": "❌ 페이지 나가기", "movies": "영화", "series": "TV 쇼", "searchPlaceholder": "영화 및 TV 프로그램 검색...", "allGenres": "모든 장르", "loadMore": "더 보기", "downloadsTab": "다운로드", "home": "홈", "profile": "프로필", "watch": "시청하기", "recommendations": "추천", "loading": "로딩 중...", "notFound": "결과 없음", "movieNotFound": "영화를 찾을 수 없음", "descriptionMissing": "설명이 없습니다.", "myFavorites": "내 즐겨찾기", "emptyFavorites": "아직 비어 있습니다 🎬", "vipStatus": "VIP 상태", "buyLifetime": "평생 구매", "buyLifetimeSub": "무제한 스트리밍을 위한 일회성 결제", "vipActive": "VIP 활성 기한", "lifetimeActive": "평생 VIP 활성", "privateModeTitle": "비공개 🍓 섹션", "privateModeDesc": "독점 성인 콘텐츠. VIP 구독자만 이용 가능합니다.", "privateBotTitle": "Приватный VIP Клуб", "open18Bot": "18+ 봇 열기", "mainBotTitle": "메인 봇 (영화 및 TV)", "mainBotDesc": "제한 없이 무료로 최신 영화와 시리즈를 시청하세요.", "openMainBot": "영화 봇 열기", "buyVipForAccess": "접근을 위해 VIP 구매", "privateCollection": "비공개 컬렉션", "privateCollectionDesc": "프리미엄 콘텐츠 비공개 컬렉션. VIP 회원만 이용 가능합니다.", "unlockWithStars": "Telegram Stars로 잠금 해제", "language": "언어", "theme": "테마", "themeAuto": "자동", "themeLight": "라이트", "themeDark": "다크", "searchPlaceholderRadio": "검색...", "back": "뒤로", "vipRequired": "VIP 필요", "vipRequiredDesc": "이 콘텐츠는 VIP 전용입니다", "openBot": "봇 열기", "movies_and_series": "영화", "radio_and_tv": "라디오 및 TV", "privateContent": "비공개", "favorites": "즐겨찾기", "subtitle_movies": "광고 없는 영화 및 시리즈", "subtitle_radio": "라이브 스트림 및 방송국", "subtitle_adult": "독점 18+ 컬렉션", "tgLoginRequired": "비공개 섹션에 접속하려면 Telegram을 통해 로그인해야 합니다", "tab_movies": "영화", "tab_series": "시리즈", "tab_radio": "라디오", "tab_tv": "TV", "tab_private": "비공개", "emptyList": "목록이 비어 있습니다", "comingSoon": "곧 제공 예정...", "player1": "플레이어 1", "player2": "플레이어 2", "buyVip": "VIP 구매 ⭐️", "supportCreator": "크리에이터 후원", "supportSubtitle": "암호화폐 전송 (USDT / TON)", "tvWarning": "참고: 지역 차단 또는 오프라인 제공 서버로 인해 일부 채널이 작동하지 않을 수 있습니다. 채널이 로드되지 않으면 다른 채널을 시도하세요.", "source1": "소스 1", "source2": "소스 2", "source3": "소스 3", "supportContact": "개발자에게 연락", "supportContactSubtitle": "기술 지원 연락", "menu": "메뉴", "supportProject": "프로젝트 후원", "scanQr": "QR 스캔 또는 아래 주소 복사", "copy": "복사", "addressCopied": "주소가 클립보드에 복사되었습니다!", "close": "닫기"},
  'id-ID': {"bannerMainBot": "Bioskop gratis di saku Anda", "bannerTelegram": "Tonton tanpa VPN di Telegram", "bannerAdult": "Bagian Rahasia 18+", "secretRoomTab": "Ruang Rahasia 🍓", "secretRoomRulesTitle": "3 Aturan Ruang Rahasia:", "secretRoomRule1": "1. Aturan pertama ruang rahasia — jangan beri tahu siapa pun tentang ruang rahasia.", "secretRoomRule2": "2. Aturan kedua ruang rahasia — jangan beri tahu siapa pun tentang aturan pertama ruang rahasia.", "secretRoomRule3": "3. Aturan ketiga ruang rahasia — saya berjanji untuk berlangganan bot TG )", "secretRoomWarning": "Dengan mengklik 'Saya Konfirmasi', Anda mengakui bahwa Anda setidaknya berusia 18 tahun dan mengambil tanggung jawab hukum penuh untuk melihat konten dewasa. Anda setuju untuk tidak mendistribusikan konten ini kepada anak di bawah umur.", "secretRoomConfirm": "✅ Saya Konfirmasi", "secretRoomLeave": "❌ Tinggalkan Halaman", "movies": "Film", "series": "Serial TV", "searchPlaceholder": "Cari film dan acara TV...", "allGenres": "Semua genre", "loadMore": "Muat lebih banyak", "downloadsTab": "Unduh", "home": "Beranda", "profile": "Profil", "watch": "Tonton", "recommendations": "Rekomendasi", "loading": "Memuat...", "notFound": "Tidak ditemukan", "movieNotFound": "Film tidak ditemukan", "descriptionMissing": "Tidak ada deskripsi yang tersedia.", "myFavorites": "Favorit Saya", "emptyFavorites": "Masih kosong di sini 🎬", "vipStatus": "Status VIP", "buyLifetime": "Beli Seumur Hidup", "buyLifetimeSub": "Pembayaran satu kali untuk streaming tanpa akhir", "vipActive": "VIP aktif hingga", "lifetimeActive": "VIP Seumur Hidup aktif", "privateModeTitle": "Bagian Pribadi 🍓", "privateModeDesc": "Konten dewasa eksklusif. Tersedia hanya untuk pelanggan VIP.", "privateBotTitle": "Приватный VIP Клуб", "open18Bot": "Buka Bot 18+", "mainBotTitle": "Bot Utama (Film & TV)", "mainBotDesc": "Tonton film dan serial baru secara gratis tanpa batas.", "openMainBot": "Buka Bot Film", "buyVipForAccess": "Beli VIP untuk akses", "privateCollection": "Koleksi Pribadi", "privateCollectionDesc": "Koleksi pribadi konten premium. Tersedia hanya untuk anggota VIP.", "unlockWithStars": "Buka dengan Telegram Stars", "language": "Bahasa", "theme": "Tema", "themeAuto": "Otomatis", "themeLight": "Terang", "themeDark": "Gelap", "searchPlaceholderRadio": "Cari...", "back": "Kembali", "vipRequired": "Diperlukan VIP", "vipRequiredDesc": "Konten ini hanya untuk VIP", "openBot": "Buka Bot", "movies_and_series": "Film", "radio_and_tv": "Radio & TV", "privateContent": "Pribadi", "favorites": "Favorit", "subtitle_movies": "Film & serial, tanpa iklan", "subtitle_radio": "Siaran langsung dan stasiun", "subtitle_adult": "Koleksi eksklusif 18+", "tgLoginRequired": "Anda harus masuk melalui Telegram untuk mengakses bagian Pribadi", "tab_movies": "Film", "tab_series": "Serial", "tab_radio": "Radio", "tab_tv": "TV", "tab_private": "Pribadi", "emptyList": "Daftar kosong", "comingSoon": "Segera hadir...", "player1": "Pemutar 1", "player2": "Pemutar 2", "buyVip": "Beli VIP ⭐️", "supportCreator": "Dukung Kreator", "supportSubtitle": "Transfer Kripto (USDT / TON)", "tvWarning": "Catatan: beberapa saluran mungkin tidak berfungsi karena pemblokiran wilayah atau server penyedia luring. Jika saluran tidak dimuat, coba yang lain.", "source1": "Sumber 1", "source2": "Sumber 2", "source3": "Sumber 3", "supportContact": "Hubungi Pengembang", "supportContactSubtitle": "Hubungi dukungan teknis", "menu": "Menu", "supportProject": "Dukung Proyek", "scanQr": "Pindai QR atau salin alamat di bawah", "copy": "Salin", "addressCopied": "Alamat disalin ke clipboard!", "close": "Tutup"},
  'hi-IN': {"bannerMainBot": "आपकी जेब में मुफ्त सिनेमा", "bannerTelegram": "टेलीग्राम में बिना VPN के देखें", "bannerAdult": "गुप्त 18+ अनुभाग", "secretRoomTab": "गुप्त कमरा 🍓", "secretRoomRulesTitle": "गुप्त कमरे के 3 नियम:", "secretRoomRule1": "1. गुप्त कमरे का पहला नियम — किसी को भी गुप्त कमरे के बारे में न बताएं।", "secretRoomRule2": "2. गुप्त कमरे का दूसरा नियम — किसी को भी गुप्त कमरे के पहले नियम के बारे में न बताएं।", "secretRoomRule3": "3. गुप्त कमरे का तीसरा नियम — मैं टीजी बॉट की सदस्यता लेने का वादा करता हूँ )", "secretRoomWarning": "'मैं पुष्टि करता हूँ' पर क्लिक करके, आप स्वीकार करते हैं कि आप कम से कम 18 वर्ष के हैं और वयस्क सामग्री देखने की पूरी कानूनी जिम्मेदारी लेते हैं। आप इस सामग्री को नाबालिगों को वितरित न करने के लिए सहमत हैं।", "secretRoomConfirm": "✅ मैं पुष्टि करता हूँ", "secretRoomLeave": "❌ पेज छोड़ें", "movies": "फिल्में", "series": "टीवी शो", "searchPlaceholder": "फिल्में और टीवी शो खोजें...", "allGenres": "सभी विधाएं", "loadMore": "और लोड करें", "downloadsTab": "डाउनलोड", "home": "होम", "profile": "प्रोफ़ाइल", "watch": "देखें", "recommendations": "सिफारिशें", "loading": "लोड हो रहा है...", "notFound": "कुछ नहीं मिला", "movieNotFound": "मूवी नहीं मिली", "descriptionMissing": "कोई विवरण उपलब्ध नहीं है।", "myFavorites": "मेरे पसंदीदा", "emptyFavorites": "यहाँ अभी खाली है 🎬", "vipStatus": "वीआईपी स्थिति", "buyLifetime": "आजीवन खरीदें", "buyLifetimeSub": "अनंत स्ट्रीमिंग के लिए एकमुश्त भुगतान", "vipActive": "वीआईपी तक सक्रिय है", "lifetimeActive": "आजीवन वीआईपी सक्रिय है", "privateModeTitle": "निजी 🍓 अनुभाग", "privateModeDesc": "विशेष वयस्क सामग्री। केवल वीआईपी ग्राहकों के लिए उपलब्ध।", "privateBotTitle": "Приватный VIP Клуб", "open18Bot": "18+ बॉट खोलें", "mainBotTitle": "मुख्य बॉट (फिल्में और टीवी)", "mainBotDesc": "बिना किसी सीमा के मुफ्त में नई फिल्में और सीरीज देखें।", "openMainBot": "मूवी बॉट खोलें", "buyVipForAccess": "पहुंच के लिए वीआईपी खरीदें", "privateCollection": "निजी संग्रह", "privateCollectionDesc": "प्रीमियम सामग्री का निजी संग्रह। केवल वीआईपी सदस्यों के लिए उपलब्ध।", "unlockWithStars": "टेलीग्राम स्टार्स के साथ अनलॉक करें", "language": "भाषा", "theme": "थीम", "themeAuto": "स्वचालित", "themeLight": "हल्का", "themeDark": "अंधेरा", "searchPlaceholderRadio": "खोजें...", "back": "पीछे", "vipRequired": "वीआईपी आवश्यक", "vipRequiredDesc": "यह सामग्री केवल वीआईपी के लिए है", "openBot": "बॉट खोलें", "movies_and_series": "फिल्में", "radio_and_tv": "रेडियो और टीवी", "privateContent": "निजी", "favorites": "पसंदीदा", "subtitle_movies": "फिल्में और श्रृंखलाएं, विज्ञापन मुक्त", "subtitle_radio": "लाइव स्ट्रीम और स्टेशन", "subtitle_adult": "विशेष 18+ संग्रह", "tgLoginRequired": "निजी अनुभाग तक पहुंचने के लिए आपको टेलीग्राम के माध्यम से लॉग इन करना होगा", "tab_movies": "फिल्में", "tab_series": "सीरीज", "tab_radio": "रेडियो", "tab_tv": "टीवी", "tab_private": "निजी", "emptyList": "सूची खाली है", "comingSoon": "जल्द आ रहा है...", "player1": "खिलाड़ी 1", "player2": "खिलाड़ी 2", "buyVip": "वीआईपी खरीदें ⭐️", "supportCreator": "निर्माता का समर्थन करें", "supportSubtitle": "क्रिप्टो ट्रांसफर (USDT / TON)", "tvWarning": "नोट: भू-अवरोध या ऑफ़लाइन प्रदाता सर्वर के कारण कुछ चैनल काम नहीं कर सकते हैं। यदि कोई चैनल लोड नहीं होता है, तो दूसरा प्रयास करें।", "source1": "स्रोत 1", "source2": "स्रोत 2", "source3": "स्रोत 3", "supportContact": "डेवलपर से संपर्क करें", "supportContactSubtitle": "तकनीकी सहायता से संपर्क करें", "menu": "मेनू", "supportProject": "परियोजना का समर्थन करें", "scanQr": "क्यूआर स्कैन करें या नीचे दिए गए पते को कॉपी करें", "copy": "कॉपी", "addressCopied": "पता क्लिपबोर्ड पर कॉपी किया गया!", "close": "बंद करें"},
  'fa-IR': {"bannerMainBot": "سینمای رایگان در جیب شما", "bannerTelegram": "تماشا بدون VPN در تلگرام", "bannerAdult": "بخش مخفی ۱۸+", "secretRoomTab": "اتاق مخفی 🍓", "secretRoomRulesTitle": "۳ قانون اتاق مخفی:", "secretRoomRule1": "۱. اولین قانون اتاق مخفی — به هیچ‌کس درباره اتاق مخفی نگویید.", "secretRoomRule2": "۲. دومین قانون اتاق مخفی — به هیچ‌کس درباره اولین قانون اتاق مخفی نگویید.", "secretRoomRule3": "۳. سومین قانون اتاق مخفی — قول می‌دهم در ربات تلگرام عضو شوم )", "secretRoomWarning": "با کلیک روی 'تایید می‌کنم'، تأیید می‌کنید که حداقل ۱۸ سال دارید و تمام مسئولیت‌های قانونی مشاهده محتوای بزرگسالان را بر عهده می‌گیرید. موافقت می‌کنید که این محتوا را بین افراد زیر سن قانونی پخش نکنید.", "secretRoomConfirm": "✅ تایید می‌کنم", "secretRoomLeave": "❌ خروج از صفحه", "movies": "فیلم‌ها", "series": "برنامه‌های تلویزیونی", "searchPlaceholder": "جستجوی فیلم و سریال...", "allGenres": "همه ژانرها", "loadMore": "بارگذاری بیشتر", "downloadsTab": "دانلود", "home": "خانه", "profile": "پروفایل", "watch": "تماشا", "recommendations": "توصیه‌ها", "loading": "در حال بارگذاری...", "notFound": "چیزی یافت نشد", "movieNotFound": "فیلم یافت نشد", "descriptionMissing": "هیچ توضیحی در دسترس نیست.", "myFavorites": "مورد علاقه‌های من", "emptyFavorites": "اینجا هنوز خالی است 🎬", "vipStatus": "وضعیت VIP", "buyLifetime": "خرید مادام‌العمر", "buyLifetimeSub": "پرداخت یک‌باره برای استریم بی‌پایان", "vipActive": "VIP فعال تا", "lifetimeActive": "VIP مادام‌العمر فعال است", "privateModeTitle": "بخش خصوصی 🍓", "privateModeDesc": "محتوای بزرگسالان انحصاری. فقط برای مشترکین VIP.", "privateBotTitle": "ربات خصوصی +VIP", "open18Bot": "باز کردن ربات +18", "mainBotTitle": "ربات اصلی (فیلم و تلویزیون)", "mainBotDesc": "فیلم‌ها و سریال‌های جدید را رایگان و بدون محدودیت تماشا کنید.", "openMainBot": "باز کردن ربات فیلم", "buyVipForAccess": "خرید VIP برای دسترسی", "privateCollection": "کالکشن خصوصی", "privateCollectionDesc": "کالکشن خصوصی محتوای پریمیوم. فقط برای اعضای VIP.", "unlockWithStars": "باز کردن با ستاره‌های تلگرام", "language": "زبان", "theme": "پوسته", "themeAuto": "خودکار", "themeLight": "روشن", "themeDark": "تاریک", "searchPlaceholderRadio": "جستجو...", "back": "بازگشت", "vipRequired": "نیاز به VIP", "vipRequiredDesc": "این محتوا فقط برای VIP است", "openBot": "باز کردن ربات", "movies_and_series": "فیلم‌ها", "radio_and_tv": "رادیو و تلویزیون", "privateContent": "خصوصی", "favorites": "علاقه‌مندی‌ها", "subtitle_movies": "فیلم‌ها و سریال‌ها، بدون تبلیغات", "subtitle_radio": "استریم‌های زنده و ایستگاه‌ها", "subtitle_adult": "کالکشن اختصاصی +18", "tgLoginRequired": "برای دسترسی به بخش خصوصی باید از طریق تلگرام وارد شوید", "tab_movies": "فیلم‌ها", "tab_series": "سریال‌ها", "tab_radio": "رادیو", "tab_tv": "تلویزیون", "tab_private": "خصوصی", "emptyList": "لیست خالی است", "comingSoon": "به‌زودی...", "player1": "پخش‌کننده ۱", "player2": "پخش‌کننده ۲", "buyVip": "خرید VIP ⭐️", "supportCreator": "حمایت از سازنده", "supportSubtitle": "انتقال کریپتو (USDT / TON)", "tvWarning": "توجه: برخی از کانال‌ها ممکن است به دلیل مسدودیت‌های جغرافیایی یا آفلاین بودن سرور ارائه‌دهنده کار نکنند. در صورت عدم بارگذاری کانال، کانال دیگری را امتحان کنید.", "source1": "منبع ۱", "source2": "منبع ۲", "source3": "منبع ۳", "supportContact": "تماس با توسعه‌دهنده", "supportContactSubtitle": "تماس با پشتیبانی فنی", "menu": "منو", "supportProject": "حمایت از پروژه", "scanQr": "اسکن کد QR یا کپی آدرس زیر", "copy": "کپی", "addressCopied": "آدرس در کلیپ‌بورد کپی شد!", "close": "بستن"},
  'es-ES': {"bannerMainBot": "Cine gratis en tu bolsillo", "bannerTelegram": "Ver sin VPN en Telegram", "bannerAdult": "Sección Secreta 18+", "secretRoomTab": "Habitación Secreta 🍓", "secretRoomRulesTitle": "3 Reglas de la Habitación Secreta:", "secretRoomRule1": "1. La primera regla de la habitación secreta — no le digas a nadie sobre la habitación secreta.", "secretRoomRule2": "2. La segunda regla de la habitación secreta — no le digas a nadie sobre la primera regla de la habitación secreta.", "secretRoomRule3": "3. La tercera regla de la habitación secreta — prometo suscribirme al bot de TG )", "secretRoomWarning": "Al hacer clic en 'Confirmo', reconoces que tienes al menos 18 años y asumes toda la responsabilidad legal por ver contenido para adultos. Aceptas no distribuir este contenido a menores.", "secretRoomConfirm": "✅ Confirmo", "secretRoomLeave": "❌ Salir de la página", "movies": "Películas", "series": "Series de TV", "searchPlaceholder": "Buscar películas y series...", "allGenres": "Todos los géneros", "loadMore": "Cargar más", "downloadsTab": "Descargar", "home": "Inicio", "profile": "Perfil", "watch": "Ver", "recommendations": "Recomendaciones", "loading": "Cargando...", "notFound": "No se encontró nada", "movieNotFound": "Película no encontrada", "descriptionMissing": "No hay descripción disponible.", "myFavorites": "Mis favoritos", "emptyFavorites": "Está vacío aquí por ahora 🎬", "vipStatus": "Estado VIP", "buyLifetime": "Comprar de por vida", "buyLifetimeSub": "Pago único para streaming sin fin", "vipActive": "VIP activo hasta", "lifetimeActive": "VIP de por vida activo", "privateModeTitle": "Sección Privada 🍓", "privateModeDesc": "Contenido exclusivo para adultos. Disponible solo para suscriptores VIP.", "privateBotTitle": "Bot Privado +VIP", "open18Bot": "Abrir Bot +18", "mainBotTitle": "Bot Principal (Películas y TV)", "mainBotDesc": "Mira nuevas películas y series gratis sin límites.", "openMainBot": "Abrir Bot de Películas", "buyVipForAccess": "Comprar VIP para acceder", "privateCollection": "Colección Privada", "privateCollectionDesc": "Colección privada de contenido premium. Disponible solo para miembros VIP.", "unlockWithStars": "Desbloquear con Telegram Stars", "language": "Idioma", "theme": "Tema", "themeAuto": "Automático", "themeLight": "Claro", "themeDark": "Oscuro", "searchPlaceholderRadio": "Buscar...", "back": "Volver", "vipRequired": "Requiere VIP", "vipRequiredDesc": "Este contenido es solo para VIP", "openBot": "Abrir Bot", "movies_and_series": "Películas", "radio_and_tv": "Radio y TV", "privateContent": "Privado", "favorites": "Favoritos", "subtitle_movies": "Películas y series, sin anuncios", "subtitle_radio": "Transmisiones en vivo y estaciones", "subtitle_adult": "Colección exclusiva +18", "tgLoginRequired": "Debes iniciar sesión a través de Telegram para acceder a la sección Privada", "tab_movies": "Películas", "tab_series": "Series", "tab_radio": "Radio", "tab_tv": "TV", "tab_private": "Privado", "emptyList": "La lista está vacía", "comingSoon": "Próximamente...", "player1": "Reproductor 1", "player2": "Reproductor 2", "buyVip": "Comprar VIP ⭐️", "supportCreator": "Apoyar al Creador", "supportSubtitle": "Transferencia Crypto (USDT / TON)", "tvWarning": "Nota: algunos canales pueden no funcionar debido a bloqueos geográficos o servidores de proveedores sin conexión. Si un canal no carga, intenta con otro.", "source1": "Fuente 1", "source2": "Fuente 2", "source3": "Fuente 3", "supportContact": "Contactar al desarrollador", "supportContactSubtitle": "Contactar a soporte técnico", "menu": "Menú", "supportProject": "Apoyar el Proyecto", "scanQr": "Escanea el código QR o copia la dirección a continuación", "copy": "Copiar", "addressCopied": "¡Dirección copiada al portapapeles!", "close": "Cerrar"},
  'de-DE': {"bannerMainBot": "Kostenloses Kino in deiner Tasche", "bannerTelegram": "Ohne VPN in Telegram ansehen", "bannerAdult": "Geheimer 18+ Bereich", "secretRoomTab": "Geheimer Raum 🍓", "secretRoomRulesTitle": "3 Regeln des geheimen Raums:", "secretRoomRule1": "1. Die erste Regel des geheimen Raums — erzähle niemandem vom geheimen Raum.", "secretRoomRule2": "2. Die zweite Regel des geheimen Raums — erzähle niemandem von der ersten Regel des geheimen Raums.", "secretRoomRule3": "3. Die dritte Regel des geheimen Raums — ich verspreche, den TG-Bot zu abonnieren )", "secretRoomWarning": "Indem Sie auf 'Ich bestätige' klicken, bestätigen Sie, dass Sie mindestens 18 Jahre alt sind, und übernehmen die volle rechtliche Verantwortung für das Ansehen von Inhalten für Erwachsene. Sie stimmen zu, diese Inhalte nicht an Minderjährige weiterzugeben.", "secretRoomConfirm": "✅ Ich bestätige", "secretRoomLeave": "❌ Seite verlassen", "movies": "Filme", "series": "Serien", "searchPlaceholder": "Filme und Serien suchen...", "allGenres": "Alle Genres", "loadMore": "Mehr laden", "downloadsTab": "Download", "home": "Start", "profile": "Profil", "watch": "Ansehen", "recommendations": "Empfehlungen", "loading": "Wird geladen...", "notFound": "Nichts gefunden", "movieNotFound": "Film nicht gefunden", "descriptionMissing": "Keine Beschreibung verfügbar.", "myFavorites": "Meine Favoriten", "emptyFavorites": "Hier ist es bisher leer 🎬", "vipStatus": "VIP Status", "buyLifetime": "Lifetime kaufen", "buyLifetimeSub": "Einmalige Zahlung für endloses Streaming", "vipActive": "VIP aktiv bis", "lifetimeActive": "Lifetime VIP aktiv", "privateModeTitle": "Privater Bereich 🍓", "privateModeDesc": "Exklusiver Inhalt für Erwachsene. Nur für VIP-Abonnenten verfügbar.", "privateBotTitle": "Приватный VIP Клуб", "open18Bot": "18+ Bot öffnen", "mainBotTitle": "Haupt-Bot (Filme & TV)", "mainBotDesc": "Sehen Sie neue Filme und Serien kostenlos ohne Grenzen.", "openMainBot": "Film-Bot öffnen", "buyVipForAccess": "VIP für Zugang kaufen", "privateCollection": "Private Kollektion", "privateCollectionDesc": "Private Kollektion mit Premium-Inhalten. Nur für VIP-Mitglieder.", "unlockWithStars": "Mit Telegram Stars freischalten", "language": "Sprache", "theme": "Design", "themeAuto": "Auto", "themeLight": "Hell", "themeDark": "Dunkel", "searchPlaceholderRadio": "Suchen...", "back": "Zurück", "vipRequired": "VIP erforderlich", "vipRequiredDesc": "Dieser Inhalt ist nur für VIPs", "openBot": "Bot öffnen", "movies_and_series": "Filme", "radio_and_tv": "Radio & TV", "privateContent": "Privat", "favorites": "Favoriten", "subtitle_movies": "Filme & Serien, werbefrei", "subtitle_radio": "Livestreams und Sender", "subtitle_adult": "Exklusive 18+ Kollektion", "tgLoginRequired": "Sie müssen sich über Telegram anmelden, um auf den privaten Bereich zuzugreifen", "tab_movies": "Filme", "tab_series": "Serien", "tab_radio": "Radio", "tab_tv": "TV", "tab_private": "Privat", "emptyList": "Liste ist leer", "comingSoon": "Demnächst...", "player1": "Player 1", "player2": "Player 2", "buyVip": "VIP kaufen ⭐️", "supportCreator": "Ersteller unterstützen", "supportSubtitle": "Krypto-Transfer (USDT / TON)", "tvWarning": "Hinweis: Einige Sender funktionieren möglicherweise aufgrund von Geoblocking oder Offline-Servern nicht. Wenn ein Sender nicht lädt, probieren Sie einen anderen.", "source1": "Quelle 1", "source2": "Quelle 2", "source3": "Quelle 3", "supportContact": "Entwickler kontaktieren", "supportContactSubtitle": "Technischen Support kontaktieren", "menu": "Menü", "supportProject": "Projekt unterstützen", "scanQr": "QR-Code scannen oder Adresse unten kopieren", "copy": "Kopieren", "addressCopied": "Adresse in die Zwischenablage kopiert!", "close": "Schließen"},
  'fr-FR': {"bannerMainBot": "Le cinéma gratuit dans votre poche", "bannerTelegram": "Regarder sans VPN sur Telegram", "bannerAdult": "Section Secrète 18+", "secretRoomTab": "Chambre Secrète 🍓", "secretRoomRulesTitle": "3 Règles de la Chambre Secrète :", "secretRoomRule1": "1. La première règle de la chambre secrète — ne parlez à personne de la chambre secrète.", "secretRoomRule2": "2. La deuxième règle de la chambre secrète — ne parlez à personne de la première règle de la chambre secrète.", "secretRoomRule3": "3. La troisième règle de la chambre secrète — je promets de m'abonner au bot TG )", "secretRoomWarning": "En cliquant sur 'Je confirme', vous reconnaissez que vous avez au moins 18 ans et assumez l'entière responsabilité légale du visionnage de contenu pour adultes. Vous acceptez de ne pas distribuer ce contenu à des mineurs.", "secretRoomConfirm": "✅ Je confirme", "secretRoomLeave": "❌ Quitter la page", "movies": "Films", "series": "Séries", "searchPlaceholder": "Rechercher films et séries...", "allGenres": "Tous les genres", "loadMore": "Charger plus", "downloadsTab": "Télécharger", "home": "Accueil", "profile": "Profil", "watch": "Regarder", "recommendations": "Recommandations", "loading": "Chargement...", "notFound": "Rien trouvé", "movieNotFound": "Film introuvable", "descriptionMissing": "Aucune description disponible.", "myFavorites": "Mes favoris", "emptyFavorites": "C'est vide ici pour le moment 🎬", "vipStatus": "Statut VIP", "buyLifetime": "Acheter à vie", "buyLifetimeSub": "Paiement unique pour le streaming sans fin", "vipActive": "VIP actif jusqu'au", "lifetimeActive": "VIP à vie actif", "privateModeTitle": "Section Privée 🍓", "privateModeDesc": "Contenu exclusif pour adultes. Disponible uniquement pour les abonnés VIP.", "privateBotTitle": "Приватный VIP Клуб", "open18Bot": "Ouvrir le Bot 18+", "mainBotTitle": "Bot Principal (Films & TV)", "mainBotDesc": "Regardez de nouveaux films et séries gratuitement sans limites.", "openMainBot": "Ouvrir le Bot Film", "buyVipForAccess": "Acheter VIP pour accéder", "privateCollection": "Collection Privée", "privateCollectionDesc": "Collection privée de contenu premium. Disponible uniquement pour les membres VIP.", "unlockWithStars": "Débloquer avec Telegram Stars", "language": "Langue", "theme": "Thème", "themeAuto": "Auto", "themeLight": "Clair", "themeDark": "Sombre", "searchPlaceholderRadio": "Rechercher...", "back": "Retour", "vipRequired": "VIP Requis", "vipRequiredDesc": "Ce contenu est réservé aux VIP", "openBot": "Ouvrir le Bot", "movies_and_series": "Films", "radio_and_tv": "Radio & TV", "privateContent": "Privé", "favorites": "Favoris", "subtitle_movies": "Films & séries, sans publicité", "subtitle_radio": "Flux en direct et stations", "subtitle_adult": "Collection exclusive 18+", "tgLoginRequired": "Vous devez vous connecter via Telegram pour accéder à la section Privée", "tab_movies": "Films", "tab_series": "Séries", "tab_radio": "Radio", "tab_tv": "TV", "tab_private": "Privé", "emptyList": "La liste est vide", "comingSoon": "Bientôt...", "player1": "Lecteur 1", "player2": "Lecteur 2", "buyVip": "Acheter VIP ⭐️", "supportCreator": "Soutenir le créateur", "supportSubtitle": "Transfert Crypto (USDT / TON)", "tvWarning": "Remarque : certaines chaînes peuvent ne pas fonctionner en raison de blocages géographiques ou de serveurs hors ligne. Si une chaîne ne se charge pas, essayez-en une autre.", "source1": "Source 1", "source2": "Source 2", "source3": "Source 3", "supportContact": "Contacter le développeur", "supportContactSubtitle": "Contacter l'assistance technique", "menu": "Menu", "supportProject": "Soutenir le projet", "scanQr": "Scannez le code QR ou copiez l'adresse ci-dessous", "copy": "Copier", "addressCopied": "Adresse copiée dans le presse-papiers !", "close": "Fermer"},
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
      if (tgLang === 'es') return 'es-ES';
      if (tgLang === 'de') return 'de-DE';
      if (tgLang === 'fr') return 'fr-FR';
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

