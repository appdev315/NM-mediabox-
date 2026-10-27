import { describe, it, expect } from 'vitest';
import ruDict from '../../locales/ru-RU.json';
import enDict from '../../locales/en-US.json';
import idDict from '../../locales/id-ID.json';
import deDict from '../../locales/de-DE.json';
import esDict from '../../locales/es-ES.json';
import frDict from '../../locales/fr-FR.json';
import { LANGUAGES_CONFIG } from '../../context/LanguageContext';

describe('Localization & Language Dictionaries Contract', () => {
  it('should include all 6 supported languages in LANGUAGES_CONFIG', () => {
    expect(LANGUAGES_CONFIG).toHaveLength(6);
    const codes = LANGUAGES_CONFIG.map(c => c.code);
    expect(codes).toEqual(['ru-RU', 'en-US', 'id-ID', 'de-DE', 'es-ES', 'fr-FR']);
  });

  it('should have non-empty baseline dictionaries for ru-RU and en-US', () => {
    expect(Object.keys(ruDict).length).toBeGreaterThan(200);
    expect(Object.keys(enDict).length).toBeGreaterThan(200);

    // Essential UI keys must be present
    expect(ruDict.movies).toBe('Фильмы');
    expect(enDict.movies).toBe('Movies');
    expect(ruDict.tv).toBe('Медиабокс ТВ');
    expect(enDict.tv).toBe('MediaBox TV');
    expect(ruDict.search).toBe('Поиск');
    expect(enDict.search).toBe('Search');
  });

  it('should have valid JSON schemas and non-empty strings across extended locales', () => {
    const extendedLocales = [
      { name: 'id-ID', dict: idDict },
      { name: 'de-DE', dict: deDict },
      { name: 'es-ES', dict: esDict },
      { name: 'fr-FR', dict: frDict },
    ];

    for (const { name, dict } of extendedLocales) {
      const keys = Object.keys(dict);
      expect(keys.length, `${name} must not be empty`).toBeGreaterThan(40);
      for (const k of keys.slice(0, 20)) {
        expect(typeof (dict as any)[k], `Key ${k} in ${name} must be a string`).toBe('string');
      }
    }
  });

  it('should have matching TV schedule keys in all languages', () => {
    const tvKeys = ['tvLive', 'tvNowOnAir', 'tvNext', 'tvProgram', 'tvScheduleToday'];
    const allDicts = [ruDict, enDict, idDict, deDict, esDict, frDict];

    for (const dict of allDicts) {
      for (const k of tvKeys) {
        expect((dict as any)[k]).toBeDefined();
        expect(typeof (dict as any)[k]).toBe('string');
      }
    }
  });

  it('should have 270 keys synchronized across all 6 locales without missing entries', () => {
    const enKeys = Object.keys(enDict);
    expect(enKeys).toHaveLength(270);
    const all = [
      { name: 'ru-RU', dict: ruDict },
      { name: 'en-US', dict: enDict },
      { name: 'id-ID', dict: idDict },
      { name: 'de-DE', dict: deDict },
      { name: 'es-ES', dict: esDict },
      { name: 'fr-FR', dict: frDict },
    ];
    for (const { name, dict } of all) {
      expect(Object.keys(dict)).toHaveLength(270);
      for (const k of enKeys) {
        expect((dict as any)[k], `Missing key ${k} in ${name}`).toBeDefined();
        expect(typeof (dict as any)[k]).toBe('string');
      }
    }
  });
});
