import { describe, expect, it } from 'vitest';
import { pipelineTemperature, temperatureRank, WARM_DAYS, COOLING_DAYS } from './pipeline-temperature';

describe('pipelineTemperature (Prompt 659 — three steps)', () => {
  it('no marker for a never-contacted investor', () => {
    expect(pipelineTemperature(null)).toBeNull();
    expect(pipelineTemperature(undefined)).toBeNull();
  });
  it('warm within 14 days, at the boundary too', () => {
    expect(pipelineTemperature(0)).toBe('warm');
    expect(pipelineTemperature(WARM_DAYS)).toBe('warm');
  });
  it('cooling from 15 to 60 days', () => {
    expect(pipelineTemperature(WARM_DAYS + 1)).toBe('cooling');
    expect(pipelineTemperature(51)).toBe('cooling'); // the July 2026 batch
    expect(pipelineTemperature(COOLING_DAYS)).toBe('cooling');
  });
  it('cold beyond 60 days', () => {
    expect(pipelineTemperature(COOLING_DAYS + 1)).toBe('cold');
    expect(pipelineTemperature(288)).toBe('cold'); // APEX Ventures
    expect(pipelineTemperature(2965)).toBe('cold'); // the eight-year-old row
  });
  it('ranks warm < cooling < cold < none for sorting', () => {
    expect(temperatureRank('warm')).toBeLessThan(temperatureRank('cooling'));
    expect(temperatureRank('cooling')).toBeLessThan(temperatureRank('cold'));
    expect(temperatureRank('cold')).toBeLessThan(temperatureRank(null));
  });
});
