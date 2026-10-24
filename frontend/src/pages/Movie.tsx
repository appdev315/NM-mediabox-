import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useTvPlayer } from '../context/TvPlayerContext';
import { Player } from '../components/Player';
import { useAdManager } from '../context/AdManager';
import { useApi, EXPRESS_API_BASE, CF_API_BASE } from '../hooks/useApi';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { usePlaybackResilience } from '../hooks/usePlaybackResilience';
import { TrailerModal } from '../components/TrailerModal';
import { PersonModal } from '../components/PersonModal';
import { MovieHero } from '../components/movie/MovieHero';
import { MovieSeasonsPicker } from '../components/movie/MovieSeasonsPicker';
import { MovieCast } from '../components/movie/MovieCast';
import { MovieSimilar } from '../components/movie/MovieSimilar';
import { MovieBottomBanner } from '../components/MovieBottomBanner';
import { BannerAd } from '../components/BannerAd';
import { useViewportExpand } from '../hooks/useViewportExpand';
import { trackOpen, trackError } from '../utils/analytics';
import { favoritesManager } from '../utils/favoritesManager';
import { clientCache } from '../utils/clientCache';
import { prewarmStream, inFlightStreamMap } from '../utils/streamPreloader';
import { getAvailability, setAvailability, useAvailabilityVersion } from '../utils/availability';
import { sortNumericKeys, buildLiftwQuery, isRussianOrigin, isNonRussianLang } from '../utils/mediaUtils';

export function Movie() {
  const { id } = useParams();
  useViewportExpand([id]);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { fetchMovieDetails, fetchPersonDetails, fetchSeasonDetails, fetchRecommendations, searchContent, searchTmdb, loading } = useApi();
  const { t, language } = useLanguage();
  const { stop: stopAudio } = useAudioPlayer();
  const { closeTv, activeChannel } = useTvPlayer();
  const { triggerMovieAd } = useAdManager();
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  // Состояние свернутого мини-плеера фильма/сериала
  const [isMovieMinimized, setIsMovieMinimized] = useState(false);
  const [sources, setSources] = useState<{name: string, url: string, label?: string, isLiftw?: boolean, episodes?: any}[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [movie, setMovie] = useState<any>(null);
  // Dedicated initial loading state eliminates the first-render 404 flash
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  // loadError separates transient network failures ('network', retryable)
  // from a confirmed TMDB 404 in both types ('not-found').
  const [loadError, setLoadError] = useState<null | 'not-found' | 'network'>(null);
  const [loadToken, setLoadToken] = useState(0);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [recPage, setRecPage] = useState(1);
  const [loadingMoreRecs, setLoadingMoreRecs] = useState(false);
  const [hasMoreRecs, setHasMoreRecs] = useState(true);
  const [recTmdbId, setRecTmdbId] = useState<string | number | null>(null);
  const [showTooltip, setShowTooltip] = useState(true);
  const [liftwEpisodes, setLiftwEpisodes] = useState<any>(null);
  const [seasonEpisodesMeta, setSeasonEpisodesMeta] = useState<Record<string, { air_date?: string; name?: string }>>({});
  const [activeSeason, setActiveSeason] = useState<string>('');
  const [activeEpisode, setActiveEpisode] = useState<string>('');
  const [targetEpisode, setTargetEpisode] = useState<{ season: string; episode: string; token?: number } | null>(null);
  const activeSeasonRef = useRef<string>('');
  const activeEpisodeRef = useRef<string>('');
  const isHealingRef = useRef<boolean>(false);
  const errorReportedRef = useRef<boolean>(false);
  const isMountedRef = useRef(true);
  const extractDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate media type
  const queryType = searchParams.get('type');
  const isTvSeries = queryType === 'series' || queryType === 'tv' || movie?.type === 'series' || movie?.type === 'tv' || (movie?.seasons && movie.seasons.length > 0) || Boolean(liftwEpisodes && Object.keys(liftwEpisodes).length > 0);
  const mediaType = isTvSeries ? 'tv' : 'movie';
  const favType = isTvSeries ? 'series' : 'movie';

  const [isFavorite, setIsFavorite] = useState(false);
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (extractDeadlineRef.current) {
        clearTimeout(extractDeadlineRef.current);
        extractDeadlineRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    isHealingRef.current = false;
    if (movie?.id) {
      setIsFavorite(favoritesManager.isFavorite(favType, movie.id));
    }
  }, [movie?.id, favType, id]);

  const handleToggleFavorite = () => {
    if (!movie?.id) return;
    if (isFavorite) {
      favoritesManager.remove(favType, movie.id);
      setIsFavorite(false);
      try {
        WebApp?.HapticFeedback?.impactOccurred('light');
      } catch (_) {}
    } else {
      favoritesManager.add(favType, {
        id: movie.id,
        title: movie.title,
        poster: movie.poster,
        rating: movie.rating,
        year: movie.year,
        type: favType,
      });
      setIsFavorite(true);
      try {
        WebApp?.HapticFeedback?.impactOccurred('medium');
      } catch (_) {}
    }
  };

  // Compute composite key for series episodes so each episode retains its own independent timecode
  const currentMediaKey = useMemo(() => {
    if (!id) return '';
    if (isTvSeries && (activeSeason || activeEpisode)) {
      return `${id}_s${activeSeason || '1'}_e${activeEpisode || '1'}`;
    }
    return String(id);
  }, [id, isTvSeries, activeSeason, activeEpisode]);

  const { savedTimecode, saveTimecode } = usePlaybackResilience({ mediaId: currentMediaKey });

  const sortedSeasons = useMemo<string[]>(() => {
    if (liftwEpisodes && Object.keys(liftwEpisodes).length > 0) {
      return sortNumericKeys(Object.keys(liftwEpisodes));
    }
    // Fallback to TMDB seasons metadata if available
    if (movie?.seasons && Array.isArray(movie.seasons)) {
      const valid: string[] = movie.seasons
        .filter((s: any) => {
          if (s.season_number <= 0) return false;
          if (s.air_date) {
            const airTime = new Date(s.air_date).getTime();
            if (airTime > Date.now() + 86400000) return false;
          }
          if (movie?.last_episode_to_air?.season_number && s.season_number > movie.last_episode_to_air.season_number) {
            return false;
          }
          return true;
        })
        .map((s: any) => String(s.season_number));
      if (valid.length > 0) return valid;
    }
    return ['1'];
  }, [liftwEpisodes, movie?.seasons, movie?.last_episode_to_air]);

  // Fetch TMDB episode details (air_date, names) for the active season
  useEffect(() => {
    const tmdbId = movie?.id && !String(movie.id).startsWith('liftw_') ? movie.id : (!String(id).startsWith('liftw_') ? id : null);
    if (!tmdbId || !isTvSeries) return;
    const currentSeason = activeSeason || (sortedSeasons[0] || '1');
    const sNum = parseInt(currentSeason, 10);
    if (isNaN(sNum) || sNum <= 0) return;

    let isSubscribed = true;
    fetchSeasonDetails(tmdbId, sNum).then((data: any) => {
      if (!isSubscribed || !data?.episodes) return;
      const metaMap: Record<string, { air_date?: string; name?: string }> = {};
      data.episodes.forEach((ep: any) => {
        if (ep?.episode_number !== undefined) {
          metaMap[String(ep.episode_number)] = {
            air_date: ep.air_date || '',
            name: ep.name || '',
          };
        }
      });
      setSeasonEpisodesMeta(metaMap);
    }).catch(() => {});

    return () => {
      isSubscribed = false;
    };
  }, [id, movie?.id, isTvSeries, activeSeason, sortedSeasons, fetchSeasonDetails]);

  const formatAirDate = useCallback((dateStr?: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}.${month}.${year}`;
    }
    return dateStr;
  }, []);

  const getEpisodeReleaseStatus = useCallback((epNumberStr: string): { isReleased: boolean; releaseDate: string } => {
    const epNum = parseInt(epNumberStr, 10);
    const currentSeason = activeSeason || (sortedSeasons[0] || '1');
    const curSeasonNum = parseInt(currentSeason, 10);

    // 1. If player already has this episode available, it is definitely released and playable
    if (liftwEpisodes?.[currentSeason] && Array.isArray(liftwEpisodes[currentSeason])) {
      const hasEpInPlayer = liftwEpisodes[currentSeason].some((e: any) => String(e) === epNumberStr);
      if (hasEpInPlayer) {
        return { isReleased: true, releaseDate: '' };
      }
    }

    // 2. Check metadata from TMDB season details
    const meta = seasonEpisodesMeta[epNumberStr] || seasonEpisodesMeta[String(epNum)];
    if (meta && meta.air_date) {
      const airTime = new Date(meta.air_date).getTime();
      const isPastOrToday = airTime <= Date.now() + 86400000;
      return {
        isReleased: isPastOrToday,
        releaseDate: formatAirDate(meta.air_date),
      };
    }

    // 3. Fallback: Check last_episode_to_air from TMDB
    const lastAir = movie?.last_episode_to_air;
    if (lastAir && typeof lastAir.season_number === 'number' && typeof lastAir.episode_number === 'number') {
      if (curSeasonNum === lastAir.season_number) {
        const isPast = epNum <= lastAir.episode_number;
        let futureDate = '';
        if (movie?.next_episode_to_air?.season_number === curSeasonNum && movie?.next_episode_to_air?.episode_number === epNum) {
          futureDate = formatAirDate(movie.next_episode_to_air.air_date);
        }
        return { isReleased: isPast, releaseDate: futureDate };
      } else if (curSeasonNum > lastAir.season_number) {
        return { isReleased: false, releaseDate: '' };
      }
    }

    if (movie?.status === 'Ended') {
      return { isReleased: true, releaseDate: '' };
    }

    return { isReleased: true, releaseDate: '' };
  }, [activeSeason, sortedSeasons, liftwEpisodes, seasonEpisodesMeta, movie?.last_episode_to_air, movie?.next_episode_to_air, movie?.status, formatAirDate]);

  const sortedEpisodes = useMemo<string[]>(() => {
    const currentSeason = activeSeason || (sortedSeasons[0] || '1');
    if (liftwEpisodes?.[currentSeason] && Array.isArray(liftwEpisodes[currentSeason])) {
      return sortNumericKeys(liftwEpisodes[currentSeason]);
    }
    // Fallback to TMDB season details if loaded
    const metaKeys = Object.keys(seasonEpisodesMeta);
    if (metaKeys.length > 0) {
      return sortNumericKeys(metaKeys);
    }
    // Fallback to TMDB episode_count
    if (movie?.seasons && Array.isArray(movie.seasons)) {
      const sInfo = movie.seasons.find((s: any) => String(s.season_number) === currentSeason);
      if (sInfo && sInfo.episode_count > 0) {
        return Array.from({ length: sInfo.episode_count }, (_, i) => String(i + 1));
      }
    }
    return ['1'];
  }, [liftwEpisodes, activeSeason, sortedSeasons, seasonEpisodesMeta, movie?.seasons]);

  const [showTrailerModal, setShowTrailerModal] = useState(false);
  const [showAudioHint, setShowAudioHint] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<number | string | null>(null);
  const userSelectedRef = useRef(false);
  const userSelectedAtRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastHistorySyncRef = useRef<number>(0);
  const [contentUnavailable, setContentUnavailable] = useState(false);

  const formatRuntime = (minutes: number) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const trailerVideo = useMemo(() => {
    const results = movie?.videos?.results;
    if (!Array.isArray(results) || results.length === 0) return null;
    const BLOCKED_KEYS = new Set(['m5keZCmBdtI']);
    const ytVideos = results.filter((v: any) => v.site === 'YouTube' && v.key && !BLOCKED_KEYS.has(v.key));
    if (ytVideos.length === 0) return null;

    const langCode = (language || 'ru-RU').split('-')[0].toLowerCase();
    return (
      ytVideos.find((v: any) => v.official && v.type === 'Trailer' && v.iso_639_1 === langCode) ||
      ytVideos.find((v: any) => v.type === 'Trailer' && v.iso_639_1 === langCode) ||
      ytVideos.find((v: any) => v.official && v.type === 'Teaser' && v.iso_639_1 === langCode) ||
      ytVideos.find((v: any) => v.type === 'Teaser' && v.iso_639_1 === langCode) ||
      ytVideos.find((v: any) => v.iso_639_1 === langCode) ||
      ytVideos.find((v: any) => v.official && v.type === 'Trailer') ||
      ytVideos.find((v: any) => v.type === 'Trailer') ||
      ytVideos.find((v: any) => v.official && v.type === 'Teaser') ||
      ytVideos.find((v: any) => v.type === 'Teaser') ||
      ytVideos[0]
    );
  }, [movie?.videos, language]);
  const directors = useMemo(() => movie?.credits?.crew?.filter((c: any) => c.job === 'Director') || [], [movie?.credits?.crew]);
  const writers = useMemo(() => movie?.credits?.crew?.filter((c: any) => c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Characters')?.slice(0, 3) || [], [movie?.credits?.crew]);
  const [showAllCast, setShowAllCast] = useState(false);
  const allCast = useMemo(() => movie?.credits?.cast || [], [movie?.credits?.cast]);
  const cast = useMemo(() => showAllCast ? allCast.slice(0, 15) : allCast.slice(0, 6), [allCast, showAllCast]);
  const availVersion = useAvailabilityVersion();
  // Available-first ordering (unknown stays in place, nothing hidden).
  // Non-Russian UIs additionally hide domestic titles.
  const displayedRecommendations = useMemo(() => {
    const rank = (r: any) => {
      const s = getAvailability(r?.type, r?.id);
      return s === 'available' ? 0 : s === 'missing' ? 2 : 1;
    };
    const list = isNonRussianLang(language)
      ? recommendations.filter((r: any) => !isRussianOrigin(r))
      : recommendations;
    return [...list].sort((a, b) => rank(a) - rank(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendations, availVersion, language]);
  const ratingPct = useMemo(() => movie?.rating ? Math.round(movie.rating * 10) : 0, [movie?.rating]);
  const isUnreleased = useMemo(() => {
    if (movie?.isUpcoming) return true;
    if (isTvSeries && (movie?.status === 'Ended' || (Array.isArray(movie?.seasons) && movie.seasons.length > 0) || liftwEpisodes)) {
      return false;
    }
    const dateStr = movie?.release_date || movie?.first_air_date;
    if (!dateStr) return false;
    const time = new Date(dateStr).getTime();
    return !isNaN(time) && time > Date.now();
  }, [movie?.isUpcoming, movie?.release_date, movie?.first_air_date, isTvSeries, movie?.seasons, movie?.status, liftwEpisodes]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Listen for non-blocking TMDB enrichment to instantly hydrate first-visit liftw cards without reload
  useEffect(() => {
    const handleEnriched = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && (detail.id === id || String(detail.id) === String(movie?.id))) {
        const enrichedMovie = detail.movie || detail.details;
        const resolvedTmdbId = detail.tmdbId || enrichedMovie?.tmdb_id;
        if (enrichedMovie) {
          setMovie((prev: any) => ({ ...(prev || {}), ...enrichedMovie }));
        }
        if (resolvedTmdbId && !recTmdbId) {
          setRecTmdbId(resolvedTmdbId);
          fetchRecommendations(resolvedTmdbId, mediaType, 1).then((recs: any) => {
            if (recs && recs.length > 0) {
              setRecommendations(recs);
              if (recs.length >= 10) setHasMoreRecs(true);
            }
          }).catch(() => {});
        }
      }
    };
    window.addEventListener('movie_enriched', handleEnriched);
    return () => window.removeEventListener('movie_enriched', handleEnriched);
  }, [id, movie?.id, mediaType, recTmdbId, fetchRecommendations]);

  // PostMessage event listener for timecode tracking and explicit 404/not_found stream fallback
  useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      // Validate trusted player origins strictly by hostname to prevent substring bypasses
      if (!event.origin) return;
      let isTrusted = false;
      try {
        const hostname = new URL(event.origin).hostname.toLowerCase();
        isTrusted =
          hostname === 'liftw.ws' ||
          hostname.endsWith('.liftw.ws') ||
          hostname === 'zenithjs.ws' ||
          hostname.endsWith('.zenithjs.ws') ||
          hostname === 'ortified.ws' ||
          hostname.endsWith('.ortified.ws') ||
          hostname === window.location.hostname.toLowerCase();
      } catch (_) {
        return;
      }
      if (!isTrusted) return;

      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data) return;

        // Timecode tracking for playback position resilience
        if (
          data.event === 'timeupdate' || 
          data.type === 'timeupdate' || 
          data.event === 'time' || 
          data.type === 'time' || 
          data.event === 'viewProgress'
        ) {
          const time = data.time || data.currentTime || data.position;
          if (typeof time === 'number' && time > 0 && currentMediaKey) {
            saveTimecode(currentMediaKey, time);
            const now = Date.now();
            if (now - lastHistorySyncRef.current > 15000 && movie?.id) {
              lastHistorySyncRef.current = now;
              favoritesManager.syncHistoryToCloud(favType, {
                id: movie.id,
                timecode: Math.floor(time)
              });
            }
          }
        }

        // Only trigger fallback if the stream is genuinely non-existent (404/not_found),
        // NEVER on transient HLS buffer stalls, bitrate switching, or ad-block warnings
        const isFatalNotFound = 
          data.error === 'not_found' ||
          data.event === 'not_found' ||
          data.status === 404 ||
          (typeof data.error === 'string' && data.error.toLowerCase().includes('not found'));

        if (isFatalNotFound && iframeUrl === sources[0]?.url) {
          console.log('[PlayerFallback] Fatal stream not-found signal received, purging dead stream from cache and triggering self-healing...');
          if (id) {
            clientCache.remove(`liftw_stream_v2_${id}_${mediaType}`);
          }
          setContentUnavailable(true);
          try {
            const errTitle = (movie as any)?.title || (movie as any)?.name || (movie as any)?.original_title || '';
            trackError(mediaType, errTitle, id ? String(id) : undefined, 'donor_not_found');
          } catch (_) {}

          if (!isHealingRef.current) {
            isHealingRef.current = true;
            handleWatch(true);
          }
        }
      } catch (e) {
        // Ignore non-JSON postMessage payloads
      }
    };

    window.addEventListener('message', handlePlayerMessage);
    return () => window.removeEventListener('message', handlePlayerMessage);
  }, [currentMediaKey, favType, iframeUrl, movie?.id, saveTimecode, sources]);

  // Season browsing is silent — updates UI dropdowns without triggering video playback.
  const handleSeasonEpisodeChange = (season: string, episode: string) => {
    activeSeasonRef.current = season;
    activeEpisodeRef.current = episode;
    setActiveSeason(season);
    setActiveEpisode(episode);
  };

  // Episode choice is the single launch trigger: commands Player via targetEpisode prop.
  const handleEpisodeSelect = (episode: string) => {
    const season = activeSeason || sortedSeasons[0] || '1';
    handleSeasonEpisodeChange(season, episode);
    userSelectedRef.current = true;
    userSelectedAtRef.current = Date.now();
    setTargetEpisode({ season, episode, token: Date.now() });
  };



  useEffect(() => {
    if (iframeUrl) {
      setShowTooltip(true);
      const timer = setTimeout(() => setShowTooltip(false), 15000);
      return () => clearTimeout(timer);
    }
  }, [iframeUrl]);

  // Audio language switch hint (shown once per session for 15s on movie/series start)
  useEffect(() => {
    if (!iframeUrl) return;

    try {
      const alreadyShown = sessionStorage.getItem('mb_audio_hint_shown');
      if (!alreadyShown) {
        setShowAudioHint(true);
        sessionStorage.setItem('mb_audio_hint_shown', 'true');

        const timer = setTimeout(() => {
          setShowAudioHint(false);
        }, 15000);

        return () => clearTimeout(timer);
      }
    } catch (_) {}
  }, [iframeUrl]);

  // Hide audio language hint when entering fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = Boolean(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      if (isFullscreen) {
        setShowAudioHint(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    let interval: any;
    if (isExtracting) {
      setLoadingProgress(0);
      interval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 90) {
            clearInterval(interval);
            return 90;
          }
          return prev + Math.random() * 10;
        });
      }, 500);
    } else {
      setLoadingProgress(100);
    }
    return () => clearInterval(interval);
  }, [isExtracting]);

  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    
    const loadData = async () => {
      // Immediately stop any active background radio when navigating to a movie or series
      stopAudio();
      setIframeUrl(null);
      setSources([]);
      setIframeUrl(null);
      setTargetEpisode(null);
      userSelectedRef.current = false;
      userSelectedAtRef.current = 0;
      setContentUnavailable(false);
      setMovie(null);
      setLoadError(null);
      setIsInitialLoading(true);
      setActiveSeason('');
      setActiveEpisode('');
      activeSeasonRef.current = '';
      activeEpisodeRef.current = '';
      userSelectedRef.current = false;
      try {
        const initialType = (queryType === 'series' || queryType === 'tv') ? 'tv' : 'movie';
        const hasExplicitType = queryType === 'series' || queryType === 'tv' || queryType === 'movie';
        let details: any;
        if (hasExplicitType || String(id).startsWith('liftw_')) {
          details = await fetchMovieDetails(id, initialType);
        } else {
          // Bare /movie/:id link (Telegram startParam, SEO, manual URL): type is
          // unknown, so race both types in parallel instead of paying for a
          // guaranteed-404 sequential fallback on a cold backend.
          const [movieRes, tvRes] = await Promise.allSettled([
            fetchMovieDetails(id, 'movie'),
            fetchMovieDetails(id, 'tv'),
          ]);
          const movieVal = movieRes.status === 'fulfilled' ? movieRes.value : null;
          const tvVal = tvRes.status === 'fulfilled' ? tvRes.value : null;
          details = movieVal ?? tvVal;
          if (movieVal && tvVal) {
            // Rare TMDB id collision across types: prefer the title match
            // when the navigation provided an expected title.
            const expectedTitle = ((location.state as any)?.title || '').toLowerCase().trim();
            if (expectedTitle) {
              const titleOf = (v: any) => String(v?.title || v?.name || '').toLowerCase();
              if (!titleOf(movieVal).includes(expectedTitle) && titleOf(tvVal).includes(expectedTitle)) {
                details = tvVal;
              }
            }
          }
          if (!details) {
            const firstErr = movieRes.status === 'rejected' ? movieRes.reason : (tvRes as PromiseRejectedResult).reason;
            throw firstErr ?? new Error('details not found');
          }
        }
        let d = details as any;
        if (!isMounted) return;

        // Defensive guard: Detect severe title collision (e.g. Liftw ID collided with TMDB ID)
        const expectedTitle = (location.state as any)?.title || '';
        if (expectedTitle && d?.title && !d?.isLiftwOnly) {
          const normExp = expectedTitle.toLowerCase().trim();
          const normGot = (d.title || d.name || '').toLowerCase().trim();
          const normOrig = (d.original_title || d.original_name || '').toLowerCase().trim();
          const isMismatch = !normGot.includes(normExp) && !normExp.includes(normGot) &&
                             !normOrig.includes(normExp) && !normExp.includes(normOrig);
          if (isMismatch) {
            try {
              const correctedRes = await searchContent(expectedTitle);
              const correctedMatch = correctedRes?.[0];
              if (correctedMatch?.id && String(correctedMatch.id) !== String(d.id)) {
                const correctedDetails = await fetchMovieDetails(correctedMatch.id, initialType);
                if (correctedDetails && isMounted) {
                  d = correctedDetails as any;
                }
              }
            } catch (_) {}
          }
        }

        setMovie(d);
        const resolvedType = (d?.type === 'series' || d?.type === 'tv' || initialType === 'tv') ? 'tv' : 'movie';
        trackOpen(resolvedType === 'tv' ? 'series' : 'movie', d?.title || d?.name || '', id);

        // Instant check in clientCache for stream and episodes
        const streamCacheKey = `liftw_stream_v2_${id}_${resolvedType}`;
        const cachedStream = clientCache.get<any>(streamCacheKey);
        if (cachedStream?.episodes && isMounted) {
          setLiftwEpisodes(cachedStream.episodes);
        }

        prewarmStream(id, {
          title: d?.name || d?.title || '',
          year: d?.year || (d?.first_air_date ? d.first_air_date.slice(0, 4) : (d?.release_date ? d.release_date.slice(0, 4) : '')),
          type: resolvedType,
          original_title: d?.original_name || d?.original_title || '',
          title_ru: (d as any)?.title_ru || (language === 'ru-RU' ? (d?.name || d?.title || '') : ''),
          release_date: d?.release_date || d?.first_air_date || '',
          isUpcoming: Boolean(d?.isUpcoming),
        }, language).then(streamData => {
          if (streamData && isMounted && streamData.episodes) {
            setLiftwEpisodes(streamData.episodes);
          }
        }).catch(() => {});

        // Fetch recommendations in background using resolved TMDB ID (resolves even for liftw_ IDs)
        setRecPage(1);
        setHasMoreRecs(true);
        setLoadingMoreRecs(false);

        let targetTmdbId: string | number | null = (d as any)?.tmdb_id
          || ((d?.id && !String(d.id).startsWith('liftw_')) ? d.id : (!String(id).startsWith('liftw_') ? id : null));

        // Fallback for rare liftw items without direct TMDB match: search TMDB by title
        if (!targetTmdbId) {
          const q = (d?.original_title || d?.title || d?.name || '').trim();
          if (q) {
            try {
              const sRes = await searchTmdb(q, resolvedType);
              const m = sRes?.[0];
              if (m?.id && !String(m.id).startsWith('liftw_')) {
                targetTmdbId = m.id;
              }
            } catch (_) {}
          }
        }

        setRecTmdbId(targetTmdbId);

        if (targetTmdbId) {
          fetchRecommendations(targetTmdbId, resolvedType, 1).then(recs => {
            if (isMounted) {
              setRecommendations(recs || []);
              if (!recs || recs.length < 10) setHasMoreRecs(false);
            }
          }).catch(() => {
            if (isMounted) setRecommendations([]);
          });
        } else {
          setRecommendations([]);
          setHasMoreRecs(false);
        }
      } catch (err: any) {
        console.error("Failed to load movie data", err);
        if (!isMounted) return;
        // A confirmed double-404 (fetchMovieDetails code NOT_FOUND) means the
        // title really doesn't exist; anything else is transient (cold HF,
        // edge timeout) and gets a retry screen instead of a false NotFound.
        setLoadError(err?.code === 'NOT_FOUND' ? 'not-found' : 'network');
      } finally {
        if (isMounted) {
          setIsInitialLoading(false);
        }
      }
    };
    
    loadData();
    window.scrollTo(0, 0);
    
    return () => {
      isMounted = false;
    };
  }, [id, queryType, fetchMovieDetails, fetchRecommendations, searchContent, loadToken]);

  const handleLoadMoreRecommendations = async () => {
    const targetId = recTmdbId || (movie?.id && !String(movie.id).startsWith('liftw_') ? movie.id : (!String(id).startsWith('liftw_') ? id : null));
    if (loadingMoreRecs || !hasMoreRecs || !targetId) return;
    setLoadingMoreRecs(true);
    const nextPage = recPage + 1;
    try {
      const nextRecs = await fetchRecommendations(targetId, mediaType, nextPage);
      if (!nextRecs || nextRecs.length === 0) {
        setHasMoreRecs(false);
      } else {
        setRecommendations(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const unique = nextRecs.filter((p: any) => !existingIds.has(p.id));
          if (unique.length === 0) {
            setHasMoreRecs(false);
            return prev;
          }
          return [...prev, ...unique];
        });
        setRecPage(nextPage);
      }
    } catch (_) {
      setHasMoreRecs(false);
    } finally {
      setLoadingMoreRecs(false);
    }
  };

  // Trigger ad when navigating to movie
  useEffect(() => {
    triggerMovieAd();
  }, [id, triggerMovieAd]); // re-trigger when movie id changes

  // Автоматическая остановка ТВ-эфира при старте фильма/сериала для исключения конфликта декодеров
  useEffect(() => {
    if (iframeUrl && activeChannel) {
      closeTv();
    }
  }, [iframeUrl, activeChannel, closeTv]);

  const handleClosePlayer = useCallback(() => {
    setIframeUrl(null);
    setIsExtracting(false);
    setIsPlayerFullscreen(false);
    setIsMovieMinimized(false);
  }, []);

  useEffect(() => {
    if (!iframeUrl) return;

    if (WebApp && WebApp.BackButton) {
      const onBack = () => {
        handleClosePlayer();
      };
      try {
        WebApp.BackButton.show();
        WebApp.BackButton.onClick(onBack);
      } catch (_) {}

      return () => {
        try {
          WebApp.BackButton.offClick(onBack);
        } catch (_) {}
      };
    }
  }, [iframeUrl, handleClosePlayer]);

  const handleWatch = async (forceRefresh = false) => {
    if (!movie) return;
    if (isUnreleased) {
      if (trailerVideo) {
        stopAudio();
        setShowTrailerModal(true);
      }
      return;
    }
    
    // Stop background music/radio strictly when the user initiates video playback
    stopAudio();

    // Add to history
    try {
      favoritesManager.addHistory(favType, {
        id: movie.id,
        title: movie.title,
        poster: movie.poster,
        type: favType,
        year: movie.year,
        rating: movie.rating,
        timecode: savedTimecode || 0
      });
    } catch (e) {
      console.error('Failed to save to history:', e);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsExtracting(true);
    setIframeUrl(null);
    setSources([]);
    setContentUnavailable(false);
    userSelectedRef.current = false;
    if (!forceRefresh) {
      errorReportedRef.current = false;
    }

    const reportPlaybackError = (reason: string) => {
      if (errorReportedRef.current) return;
      errorReportedRef.current = true;
      try {
        const errTitle = (movie as any)?.title || (movie as any)?.name || (movie as any)?.original_title || '';
        trackError(mediaType, errTitle, id ? String(id) : undefined, reason);
      } catch (_) {}
    };
    
    // Scroll to player placeholder immediately
    setTimeout(() => {
      document.getElementById('video-player-container')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const rawYear = (movie as any).year || ((movie as any).first_air_date ? String((movie as any).first_air_date).slice(0, 4) : ((movie as any).release_date ? String((movie as any).release_date).slice(0, 4) : ''));
      const queryParams: Record<string, string> = {
        title: (movie as any).name || (movie as any).title || '',
        year: rawYear || '',
        type: mediaType,
        tmdb: (movie as any).id?.toString() || '',
        imdb: (movie as any).imdb_id || ''
      };

      const originalTitle = (movie as any)?.original_title || (movie as any)?.original_name || '';
      const ruTitle = (movie as any)?.title_ru || (language === 'ru-RU' ? ((movie as any)?.title || (movie as any)?.name) : '') || queryParams.title;

      // Fetch stream from Liftw
      const effectiveLiftwId = (movie as any)?.liftw_id || 
        (location.state as any)?.liftw_id || 
        (String(id).startsWith('liftw_') ? String(id).replace(/^liftw_/, '') : undefined);

      const baseQuery = buildLiftwQuery({
        title: queryParams.title,
        year: queryParams.year,
        type: queryParams.type,
        tmdb: queryParams.tmdb,
        title_ru: ruTitle,
        original_title: originalTitle,
        liftw_id: effectiveLiftwId,
        language
      });
      const liftwQuery = new URLSearchParams(baseQuery);
      if (forceRefresh) {
        if (id) {
          clientCache.remove(`liftw_stream_v2_${id}_${mediaType}`);
        }
        liftwQuery.append('bypass_cache', 'true');
      }

      let foundLiftw: any = null;



      const updateUI = () => {
        if (!isMountedRef.current) return;
        const combined: any[] = [];
        
        // Primary Player: Liftw (1080p with built-in audio/subtitles switcher)
        if (foundLiftw) {
          const liftwUrl = foundLiftw.url;
          combined.push({
            name: 'player1',
            label: t('player1') || 'Плеер 1',
            url: liftwUrl,
            isLiftw: true
          });
        }

        setSources(combined);

        if (combined.length > 0 && foundLiftw) {
          const preferredUrl = foundLiftw.url;
          if (!userSelectedRef.current) {
            setIframeUrl(preferredUrl);
          } else {
            setIframeUrl(prev => prev || preferredUrl);
          }
          setIsExtracting(false);
        }
      };

      // 2. Fetch liftw asynchronously (Primary Player — Priority #1, 1080p)
      const fetchLiftw = async () => {
        try {
          const streamCacheKey = `liftw_stream_v2_${id}_${mediaType}`;
          const queryStr = liftwQuery.toString();

        // Instant 0ms read from client cache
        let liftwData: any = !forceRefresh ? clientCache.get<any>(streamCacheKey) : null;
        if (liftwData && !liftwData.iframe) {
          clientCache.remove(streamCacheKey);
          liftwData = null;
        }

        // Instant check: if movie details already carry verified iframe from fast-path, use it immediately (0ms)
        if (!liftwData && !forceRefresh && (movie as any)?.iframe) {
          liftwData = {
            iframe: (movie as any).iframe,
            episodes: (movie as any).episodes,
            liftwId: (movie as any).liftw_id,
            liftwType: (movie as any).liftwType,
          };
          clientCache.set(streamCacheKey, liftwData, mediaType === 'tv' ? 86400 : 2592000);
        }

        // If not cached, connect to in-flight prewarm stream if running
        if (!liftwData && !forceRefresh && inFlightStreamMap.has(streamCacheKey)) {
          liftwData = await inFlightStreamMap.get(streamCacheKey);
        }

        if (!liftwData) {
          const tryFetchLiftw = async (baseUrl: string, timeoutMs: number) => {
            const timeoutCtrl = new AbortController();
            const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
            try {
              const res = await fetchWithRetry(`${baseUrl}/liftw?${queryStr}`, {
                maxRetries: 1,
                baseDelayMs: 200,
                maxDelayMs: 600,
                signal: timeoutCtrl.signal,
              });
              clearTimeout(timeoutId);
              if (!res.ok) return null;
              return await res.json();
            } catch (_) {
              clearTimeout(timeoutId);
              return null;
            }
          };

          try {
            // 1. Query Cloudflare Edge Cache first (primary edge, 0 redundant backend hits)
            liftwData = await tryFetchLiftw(CF_API_BASE, 8500);

            // 2. Fallback to Express microservice if Cloudflare didn't return stream
            if (!liftwData || !liftwData.iframe) {
              const hfData = await tryFetchLiftw(EXPRESS_API_BASE, 6500);
              if (hfData && hfData.iframe) {
                liftwData = hfData;
              }
            }

            if (liftwData && liftwData.iframe) {
              const isOngoing = (movie as any)?.status === 'Returning Series' || (movie as any)?.in_production;
              const streamTtl = mediaType === 'tv' ? (isOngoing ? 1800 : 86400) : 2592000; // 30m for ongoing TV, 24h for completed TV, 30d Movies
              clientCache.set(streamCacheKey, liftwData, streamTtl);
              if (id) setAvailability(mediaType, id, 'available');
            } else {
              if (id) setAvailability(mediaType, id, 'missing');
              reportPlaybackError('liftw_empty');
            }
          } catch (e) {
            console.error("Liftw fetch failed", e);
            reportPlaybackError('liftw_fetch_failed');
          }
        }

        if (liftwData && liftwData.iframe) {
          const initialUrl = liftwData.iframe;
          foundLiftw = { name: 'player1', url: initialUrl, isLiftw: true };

          if (liftwData.episodes) {
            setLiftwEpisodes(liftwData.episodes);
            const initSortedSeasons = sortNumericKeys(Object.keys(liftwData.episodes));
            const firstSeason = initSortedSeasons[0] || '1';
            const firstSeasonEpisodes = liftwData.episodes[firstSeason] || [];
            const sortedFirstSeasonEps = sortNumericKeys(firstSeasonEpisodes);
            const firstEpisode = sortedFirstSeasonEps[0] || '1';

            const targetS = activeSeasonRef.current || firstSeason;
            const targetE = activeEpisodeRef.current || firstEpisode;
            if (!activeSeasonRef.current) {
              setActiveSeason(firstSeason);
              activeSeasonRef.current = firstSeason;
            }
            if (!activeEpisodeRef.current) {
              setActiveEpisode(firstEpisode);
              activeEpisodeRef.current = firstEpisode;
            }
            setTargetEpisode({ season: targetS, episode: targetE, token: Date.now() });
          }

          // Liftw source is Priority #1: Immediately render Player 1 and unblock UI
          updateUI();
          setIsExtracting(false);
        }
      } catch (e) {
        console.error("fetchLiftw error", e);
        reportPlaybackError('liftw_fetch_error');
      }
    };

    // 10s UI deadline: if Liftw doesn't respond, stop spinner and show unavailable
    if (extractDeadlineRef.current) {
      clearTimeout(extractDeadlineRef.current);
    }
    extractDeadlineRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (foundLiftw === null) {
        setIsExtracting(false);
        setContentUnavailable(true);
        reportPlaybackError('liftw_timeout_10s');
      }
    }, 10000);

    // Fetch primary player (Liftw)
    fetchLiftw().finally(() => {
      if (!isMountedRef.current) return;
      updateUI();
      if (extractDeadlineRef.current) {
        clearTimeout(extractDeadlineRef.current);
        extractDeadlineRef.current = null;
      }
      setIsExtracting(false);
      if (foundLiftw === null) {
        setContentUnavailable(true);
        reportPlaybackError('liftw_empty');
      }
    });
    } catch (err) {
      console.error("Failed to extract stream", err);
      alert("Failed to load stream");
    } finally {
      setTimeout(() => {
        document.getElementById('video-player-container')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  };

  const displayTitle = (language !== 'ru-RU' && (movie?.original_title || movie?.original_name))
    ? (movie.original_title || movie.original_name)
    : (movie?.title || movie?.name || '');
  const displayYear = movie?.year || (movie?.release_date ? movie.release_date.slice(0, 4) : '') || (movie?.first_air_date ? movie.first_air_date.slice(0, 4) : '');
  const seoTitle = displayTitle ? `${displayTitle}${displayYear ? ` (${displayYear})` : ''} — MediaBox` : 'MediaBox';

  const rawOverview = movie?.overview || movie?.description || '';
  const seoDescription = rawOverview.length > 0
    ? (rawOverview.length > 160 ? rawOverview.slice(0, 157).trim() + '...' : rawOverview)
    : `${displayTitle}${displayYear ? ` (${displayYear})` : ''} — MediaBox`;

  // Direct TMDB image URL without proxy for bots / external social previews
  const tmdbImgPath = movie?.backdrop_path || movie?.poster_path || 
    (typeof movie?.backdrop === 'string' ? movie.backdrop.replace(/.*\/t\/p\/[^\/]+/, '') : '') ||
    (typeof movie?.poster === 'string' ? movie.poster.replace(/.*\/t\/p\/[^\/]+/, '') : '');
  const cleanImgPath = tmdbImgPath ? (tmdbImgPath.startsWith('/') ? tmdbImgPath : '/' + tmdbImgPath) : '';
  const ogImageUrl = cleanImgPath ? `https://image.tmdb.org/t/p/w780${cleanImgPath}` : 'https://media-box.xyz/kiss-bg.png';

  const canonicalUrl = `https://media-box.xyz/movie/${movie?.id || id}?type=${isTvSeries ? 'series' : 'movie'}`;

  // JSON-LD structured data (Movie / TVSeries)
  const jsonLdData = useMemo(() => {
    if (!movie) return null;
    const schema: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': isTvSeries ? 'TVSeries' : 'Movie',
      name: displayTitle,
      description: seoDescription,
      image: ogImageUrl,
      url: canonicalUrl,
    };

    if (movie.release_date || movie.first_air_date) {
      schema.datePublished = movie.release_date || movie.first_air_date;
    } else if (displayYear) {
      schema.datePublished = displayYear;
    }

    if (Array.isArray(movie.genres) && movie.genres.length > 0) {
      schema.genre = movie.genres.map((g: any) => (typeof g === 'string' ? g : g.name)).filter(Boolean);
    }

    if (movie.vote_count && movie.vote_count > 0 && movie.vote_average) {
      schema.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: Number(movie.vote_average).toFixed(1),
        bestRating: '10',
        worstRating: '1',
        ratingCount: movie.vote_count,
      };
    }

    return schema;
  }, [movie, isTvSeries, displayTitle, displayYear, seoDescription, ogImageUrl, canonicalUrl]);

  // Set document title and safe DOM injection for JSON-LD structured data
  useEffect(() => {
    if (seoTitle && movie) {
      document.title = seoTitle;
    }
    if (!jsonLdData) return;
    let scriptEl = document.getElementById('jsonld-movie-schema') as HTMLScriptElement | null;
    if (!scriptEl) {
      scriptEl = document.createElement('script');
      scriptEl.id = 'jsonld-movie-schema';
      scriptEl.type = 'application/ld+json';
      document.head.appendChild(scriptEl);
    }
    scriptEl.textContent = JSON.stringify(jsonLdData);
    return () => {
      const el = document.getElementById('jsonld-movie-schema');
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    };
  }, [seoTitle, jsonLdData, movie]);

  if ((isInitialLoading || (loading && !movie)) && !movie) {
    return (
      <div className="p-4 pt-24 pb-20 flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium opacity-50">{t('loading')}</div>
      </div>
    );
  }

  if (!movie && loadError === 'network') {
    return (
      <div className="p-4 pt-24 pb-20 flex flex-col items-center justify-center min-h-[50vh] text-center">
        <div className="text-4xl mb-2">📡</div>
        <div className="font-bold mb-1">{t('contentUnavailable') || 'Контент временно недоступен'}</div>
        <div className="text-sm opacity-70 mb-4 max-w-xs">{t('contentUnavailableDesc') || 'Не удалось загрузить данные. Проверьте соединение и попробуйте ещё раз.'}</div>
        <div className="flex gap-2">
          <button
            onClick={() => setLoadToken(v => v + 1)}
            className="px-6 py-3 rounded-xl font-bold text-sm transition-transform active:scale-95 shadow"
            style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
          >
            ↻ {t('retry') || 'Повторить'}
          </button>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 rounded-xl font-bold text-sm transition-opacity opacity-70 hover:opacity-100"
            style={{ color: 'var(--text-color)' }}
          >
            ← {t('chooseAnother') || 'Выбрать другой фильм'}
          </button>
        </div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="p-4 pt-24 pb-20 flex flex-col items-center justify-center min-h-[50vh]">
        <div className="text-4xl mb-2">🎬</div>
        <div className="font-medium opacity-70 mb-4">{t('movieNotFound')}</div>
      </div>
    );
  }

  return (
    <div className="pb-32 sm:pb-36 animate-fade-in">
      <MovieHero
        movie={movie}
        mediaType={mediaType}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
        ratingPct={ratingPct}
        trailerVideo={trailerVideo}
        onOpenTrailer={() => {
          stopAudio();
          setShowTrailerModal(true);
        }}
        contentUnavailable={contentUnavailable}
        isUnreleased={isUnreleased}
        isExtracting={isExtracting}
        iframeUrl={iframeUrl}
        onWatch={() => handleWatch(false)}
        formatRuntime={formatRuntime}
      />

      <div className="px-4">
        {/* Overview / Обзор */}
        <div className="mb-6 space-y-1">
          <h3 className="font-extrabold text-base">{t("overview")}</h3>
          <p className="text-[14px] opacity-90 leading-relaxed font-medium">
            {movie.description || movie.overview || t("descriptionMissing")}
          </p>
        </div>

        {/* Creators / Создатели */}
        {(directors.length > 0 || writers.length > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6 border-t border-white/10 pt-4 text-xs">
            {directors.map((d: any) => (
              <div
                key={d.id}
                onClick={() => setSelectedPersonId(d.id)}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                <p className="font-extrabold text-sm">{d.name}</p>
                <p className="opacity-60">{t("director")}</p>
              </div>
            ))}
            {writers.map((w: any) => (
              <div
                key={w.id}
                onClick={() => setSelectedPersonId(w.id)}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                <p className="font-extrabold text-sm">{w.name}</p>
                <p className="opacity-60">{t("writer")}</p>
              </div>
            ))}
          </div>
        )}

        {/* Recommendations in idle mode */}
        {!isExtracting && !iframeUrl && (
          <MovieSimilar
            recommendations={displayedRecommendations}
            hasMoreRecs={hasMoreRecs}
            loadingMoreRecs={loadingMoreRecs}
            onLoadMore={handleLoadMoreRecommendations}
            onSelectMovie={(rec) => {
              setIframeUrl(null);
              setSources([]);
              navigate(`/movie/${rec.id}?type=${rec.type || "movie"}`);
            }}
            language={language}
          />
        )}

        {/* Bottom Movie Banner in idle mode */}
        {!isExtracting && !iframeUrl && (
          <MovieBottomBanner />
        )}

        {/* Video Player Container */}
        <div id="video-player-container" className="relative">
          {showTooltip && WebApp.platform !== "unknown" && (
            <div className="w-full bg-red-500/10 text-red-400 text-xs text-center py-2 px-4 font-medium rounded-lg mb-2 flex justify-center items-center border border-red-500/20">
              <span className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                {t("cancelPrompt")}
              </span>
            </div>
          )}
          {(isExtracting || iframeUrl) && (
            <div 
              className={
                isMovieMinimized
                  ? "fixed bottom-20 right-3 sm:right-6 z-50 w-72 sm:w-80 rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-black flex flex-col pointer-events-auto transition-all animate-fade-in group cursor-pointer select-none"
                  : `relative w-full ${isPlayerFullscreen ? "z-[99999]" : "md:w-[80%] mx-auto mt-2 mb-8"}`
              }
              onClick={isMovieMinimized ? () => setIsMovieMinimized(false) : undefined}
            >
              {/* Компактная плашка управления мини-плеером фильма (PiP) */}
              {isMovieMinimized && (
                <div 
                  className="absolute top-0 left-0 right-0 z-40 px-3 py-2 flex items-center justify-between bg-gradient-to-b from-black/90 via-black/50 to-transparent pointer-events-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div 
                    className="flex items-center gap-1.5 min-w-0 cursor-pointer"
                    onClick={() => setIsMovieMinimized(false)}
                  >
                    <span className="font-bold text-white text-xs truncate max-w-[140px]">
                      {movie?.title || ''}
                    </span>
                    {mediaType === 'tv' && activeSeason && (
                      <span className="text-[10px] text-amber-300 font-mono font-bold shrink-0">
                        S{activeSeason}E{activeEpisode || '1'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsMovieMinimized(false)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/15 hover:bg-white/25 active:scale-95 text-white transition-all cursor-pointer border border-white/15 text-xs font-bold"
                      title={t('expand') || 'Развернуть'}
                      aria-label={t('expand') || 'Развернуть'}
                    >
                      ⤢
                    </button>
                    <button
                      type="button"
                      onClick={handleClosePlayer}
                      className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-600/80 hover:bg-red-600 active:scale-95 text-white transition-all cursor-pointer border border-white/15 text-xs font-bold"
                      title={t('close') || 'Закрыть'}
                      aria-label={t('close') || 'Закрыть'}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Верхняя компактная панель плеера фильма в обычном режиме */}
              {!isMovieMinimized && !isPlayerFullscreen && iframeUrl && (
                <div className="w-full flex items-center justify-between pb-1.5 px-0.5 pointer-events-auto">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-white/90 truncate">
                      {movie?.title || ''} {mediaType === 'tv' && activeSeason ? `(S${activeSeason}E${activeEpisode || '1'})` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsMovieMinimized(true)}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xs font-bold flex items-center gap-1 transition-all cursor-pointer border border-white/10"
                      title={t('minimize') || 'В окно'}
                    >
                      <span className="text-xs">⤓</span>
                      <span>{t('minimize') || 'Свернуть'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClosePlayer}
                      className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xs font-bold flex items-center justify-center transition-all cursor-pointer border border-white/10"
                      title={t('close') || 'Закрыть'}
                      aria-label={t('close') || 'Закрыть'}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {showAudioHint && !isExtracting && iframeUrl && !isPlayerFullscreen && !isMovieMinimized && (
                <div
                  onClick={() => setShowAudioHint(false)}
                  className="absolute -top-10 sm:-top-11 right-0 sm:right-2 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white text-[11px] sm:text-xs font-extrabold shadow-lg border border-white/20 cursor-pointer select-none max-w-[calc(100%-16px)] animate-pulse"
                  title={t("clickToHide") || "Нажмите, чтобы скрыть"}
                >
                  <span className="truncate">🎧 {t("audioLanguageHint") || "Переключи язык аудио здесь"}</span>
                  <span className="text-amber-300 text-sm sm:text-base font-black shrink-0">↘️</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowAudioHint(false); }}
                    className="ml-1 text-white/70 hover:text-white text-xs font-bold p-0.5 shrink-0 cursor-pointer"
                    aria-label={t("close") || "Закрыть"}
                  >
                    ✕
                  </button>
                </div>
              )}

              <div id="video-player" className={`relative w-full ${isMovieMinimized ? "aspect-video rounded-2xl overflow-hidden bg-black flex flex-col" : isPlayerFullscreen ? "bg-black" : "aspect-video rounded-lg overflow-hidden bg-black shadow-xl flex items-center justify-center"}`}>
                {isExtracting ? (
                  <div className="flex flex-col items-center justify-center text-white/70 w-full px-8">
                    <div className="w-full max-w-[200px] h-1.5 bg-gray-800 rounded-full overflow-hidden mb-4 shadow-inner">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                        style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
                      />
                    </div>
                    <p className="text-blue-400 text-xs font-bold tracking-wider uppercase animate-pulse">{t("loading")} {Math.round(loadingProgress)}%</p>
                  </div>
                ) : iframeUrl ? (
                  <div className="w-full h-full flex flex-col relative group">
                    <div className="flex-1 w-full h-full">
                      <Player 
                        iframeUrl={iframeUrl} 
                        initialTimecode={savedTimecode || undefined} 
                        targetEpisode={mediaType === "tv" ? targetEpisode : undefined}
                        onFullscreenChange={setIsPlayerFullscreen}
                        onClose={handleClosePlayer}
                        onMinimize={() => setIsMovieMinimized(true)}
                        onEpisodeChange={(s, e) => {
                          if (userSelectedAtRef.current && Date.now() - userSelectedAtRef.current < 3500) {
                            if (targetEpisode && (s !== targetEpisode.season || e !== targetEpisode.episode)) {
                              return;
                            }
                            userSelectedAtRef.current = 0;
                          }
                          activeSeasonRef.current = s;
                          activeEpisodeRef.current = e;
                          setActiveSeason(s);
                          setActiveEpisode(e);
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Seasons & Episodes in Watch Mode */}
        {(isExtracting || iframeUrl) && mediaType === "tv" && (
          <MovieSeasonsPicker
            sortedSeasons={sortedSeasons}
            activeSeason={activeSeason}
            sortedEpisodes={sortedEpisodes}
            activeEpisode={activeEpisode}
            onSeasonChange={(season) => {
              const availableEpisodes = Array.isArray(liftwEpisodes?.[season]) ? liftwEpisodes[season] : ["1"];
              const sortedAvail = sortNumericKeys(availableEpisodes);
              const targetEp = sortedAvail[0] || "1";
              handleSeasonEpisodeChange(season, targetEp);
              userSelectedRef.current = true;
              userSelectedAtRef.current = Date.now();
              setTargetEpisode({ season, episode: targetEp, token: Date.now() });
            }}
            onEpisodeSelect={handleEpisodeSelect}
            getEpisodeReleaseStatus={getEpisodeReleaseStatus}
          />
        )}

        {/* Secret Room Banner in Watch Mode */}
        {(isExtracting || iframeUrl) && (
          <div className="my-4">
            <BannerAd />
          </div>
        )}

        {/* Cast Carousel in Watch Mode */}
        {(isExtracting || iframeUrl) && (
          <MovieCast
            cast={cast}
            allCastLength={allCast.length}
            showAllCast={showAllCast}
            onToggleShowAllCast={() => setShowAllCast(prev => !prev)}
            onSelectPerson={setSelectedPersonId}
          />
        )}

        {/* Recommendations in Watch Mode */}
        {(isExtracting || iframeUrl) && (
          <MovieSimilar
            recommendations={displayedRecommendations}
            hasMoreRecs={hasMoreRecs}
            loadingMoreRecs={loadingMoreRecs}
            onLoadMore={handleLoadMoreRecommendations}
            onSelectMovie={(rec) => {
              setIframeUrl(null);
              setSources([]);
              navigate(`/movie/${rec.id}?type=${rec.type || "movie"}`);
            }}
            language={language}
          />
        )}

        {/* Bottom Banner in Watch Mode */}
        {(isExtracting || iframeUrl) && (
          <MovieBottomBanner slotId="movie-watch-bottom" className="my-4" />
        )}
      </div>

      {/* Trailer Modal */}
      {showTrailerModal && trailerVideo && (
        <TrailerModal
          videoKey={trailerVideo.key}
          title={movie?.title || ""}
          onClose={() => setShowTrailerModal(false)}
        />
      )}

      {/* Person Details Modal */}
      {selectedPersonId && (
        <PersonModal
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
          fetchPersonDetails={fetchPersonDetails}
        />
      )}
    </div>
  );
}
