import { describe, expect, it } from 'vitest';
import { containsMethodologyLanguage, detectMethodologyLanguage } from '$lib/domain/values/MethodologyGuard';

describe('MethodologyGuard', () => {
  describe('detects research-process language', () => {
    it.each([
      ['I searched the web for sources on this topic.'],
      ['We investigated by reading several articles about the subject.'],
      ['After gathering sources, the analysis began.'],
      ['The research process involved multiple lookup rounds.'],
      ['As the aspect worker, my task was to identify the key facts.'],
      ['The orchestrator handed off the synthesis to me.'],
      ['Methodology: first I searched, then I read the results.'],
      ['## Search Results\n\n- Source 1\n- Source 2'],
      ['I will research this topic and gather sources.'],
      ['Source 1: The Wikipedia article says the topic is interesting.'],
    ])('flags %j', (input) => {
      expect(containsMethodologyLanguage(input)).toBe(true);
    });
  });

  describe('passes substantive subject prose', () => {
    it.each([
      ['Rust ownership moves a value when it is assigned to a new binding [1]. The original variable becomes invalid at that moment.'],
      ['The album was released in 2024 by Capitol Records [2]. Critics praised the production quality, though some found the tracklist uneven.'],
      ['Final Fantasy XIV: Dawntrail introduces two new jobs and expands the Tural region with new biomes [1]. The expansion ships on a single physical disc.'],
      ['# Origins\n\nThe topic originated in the mid-1990s among researchers studying parallel computation.'],
      ['*Unverified:* This claim has no source backing but is included for completeness.'],
    ])('allows %j', (input) => {
      expect(containsMethodologyLanguage(input)).toBe(false);
    });
  });

  it('returns hit details for diagnostics', () => {
    const hits = detectMethodologyLanguage('I searched for sources. After gathering sources, I wrote this.');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveProperty('pattern');
    expect(hits[0]).toHaveProperty('match');
  });

  it('returns no hits for empty input', () => {
    expect(detectMethodologyLanguage('')).toEqual([]);
    expect(containsMethodologyLanguage('')).toBe(false);
  });
});
