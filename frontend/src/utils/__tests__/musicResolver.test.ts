import { describe, it, expect } from 'vitest';
import {
  cleanTrackTitle,
  cleanPrimaryArtist,
  buildResolveCacheKey,
  parseYtDuration,
  parseYtTrackInfo,
  extractInvidiousAudio,
  extractAudioUrl,
  extractLowAudioUrl,
} from '../musicResolver';

describe('musicResolver unit tests', () => {
  describe('title and artist normalization', () => {
    it('cleans junk annotations from track title', () => {
      expect(cleanTrackTitle('Sonne (Official Music Video)')).toBe('Sonne');
      expect(cleanTrackTitle('Du Hast [Remastered 2023]')).toBe('Du Hast');
      expect(cleanTrackTitle('Numb (Lyric Video) [Explicit]')).toBe('Numb');
      expect(cleanTrackTitle('In The End (Live Version)')).toBe('In The End');
    });

    it('extracts primary artist cleanly', () => {
      expect(cleanPrimaryArtist('Eminem feat. Rihanna')).toBe('Eminem');
      expect(cleanPrimaryArtist('Linkin Park ft. Jay-Z')).toBe('Linkin Park');
      expect(cleanPrimaryArtist('Баста & Zivert')).toBe('Баста');
      expect(cleanPrimaryArtist('Drake, 21 Savage')).toBe('Drake');
      expect(cleanPrimaryArtist('David Guetta / Bebe Rexha')).toBe('David Guetta');
    });
  });

  describe('buildResolveCacheKey', () => {
    it('generates isolated keys for YouTube tracks', () => {
      const keys = buildResolveCacheKey('Rammstein', 'Sonne', 'yt_kJQP7kiw5Fk');
      expect(keys.isYt).toBe(true);
      expect(keys.videoId).toBe('kJQP7kiw5Fk');
      expect(keys.cacheKey).toBe('resolved_audio_v4_yt_kJQP7kiw5Fk');
      expect(keys.negCacheKey).toBe('neg_resolved_audio_v4_yt_kJQP7kiw5Fk');
      expect(keys.flightKey).toBe('yt_kJQP7kiw5Fk');
    });

    it('generates isolated keys for Saavn tracks', () => {
      const keys = buildResolveCacheKey('Rammstein', 'Sonne', 'saavn_P9E3rX22');
      expect(keys.isYt).toBe(false);
      expect(keys.saavnId).toBe('P9E3rX22');
      expect(keys.cacheKey).toBe('resolved_audio_v4_saavn_P9E3rX22');
      expect(keys.negCacheKey).toBe('neg_resolved_audio_v4_saavn_P9E3rX22');
      expect(keys.flightKey).toBe('saavn_P9E3rX22');
    });

    it('generates slug keys for general metadata queries', () => {
      const keys = buildResolveCacheKey('Linkin Park feat. Jay-Z', 'Numb (Official Video)');
      expect(keys.isYt).toBe(false);
      expect(keys.cacheKey).toBe('resolved_audio_v4_linkin park_numb');
      expect(keys.negCacheKey).toBe('neg_resolved_audio_v4_linkin park_numb');
      expect(keys.flightKey).toBe('meta_linkin park_numb');
    });
  });

  describe('parseYtDuration', () => {
    it('parses mm:ss and hh:mm:ss strings', () => {
      expect(parseYtDuration({ duration: '3:45' })).toBe(225);
      expect(parseYtDuration({ duration: '0:30' })).toBe(30);
      expect(parseYtDuration({ duration: '1:02:15' })).toBe(3735);
    });

    it('extracts lengthSeconds number', () => {
      expect(parseYtDuration({ lengthSeconds: 180 })).toBe(180);
      expect(parseYtDuration({})).toBe(0);
    });
  });

  describe('parseYtTrackInfo', () => {
    it('splits artist and title separated by dash', () => {
      const parsed = parseYtTrackInfo('Rammstein - Sonne', 'Rammstein - Topic');
      expect(parsed.artist).toBe('Rammstein');
      expect(parsed.title).toBe('Sonne');
    });

    it('falls back to author when no dash is present', () => {
      const parsed = parseYtTrackInfo('Sonne', 'Rammstein - Topic');
      expect(parsed.artist).toBe('Rammstein');
      expect(parsed.title).toBe('Sonne');
    });
  });

  describe('extractAudioUrl and extractInvidiousAudio', () => {
    it('picks 320kbps in normal mode and 96kbps in slow mode for Saavn', () => {
      const downloadUrls = [
        { quality: '48kbps', url: 'https://cdn/48.mp4' },
        { quality: '96kbps', url: 'https://cdn/96.mp4' },
        { quality: '160kbps', url: 'https://cdn/160.mp4' },
        { quality: '320kbps', url: 'https://cdn/320.mp4' },
      ];
      expect(extractAudioUrl(downloadUrls, false)).toBe('https://cdn/320.mp4');
      expect(extractAudioUrl(downloadUrls, true)).toBe('https://cdn/96.mp4');
      expect(extractLowAudioUrl(downloadUrls)).toBe('https://cdn/96.mp4');
    });

    it('picks m4a audio stream for Invidious formats', () => {
      const formats = [
        { type: 'audio/webm; codecs="opus"', bitrate: '50000', url: 'https://inst/opus_low' },
        { type: 'audio/mp4; codecs="mp4a.40.2"', container: 'm4a', bitrate: '128000', url: 'https://inst/m4a_high' },
        { type: 'video/mp4', bitrate: '500000', url: 'https://inst/video' },
      ];
      expect(extractInvidiousAudio(formats, false)).toBe('https://inst/m4a_high');
      expect(extractInvidiousAudio(formats, true)).toBe('https://inst/opus_low');
    });
  });
});
