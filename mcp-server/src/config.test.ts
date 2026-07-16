import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_BASE_URL } from './client.js';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('falls back to DEFAULT_BASE_URL when DEVDIGEST_API_URL is unset', () => {
    expect(loadConfig({}).apiBaseUrl).toBe(DEFAULT_BASE_URL);
  });

  it('passes through a valid DEVDIGEST_API_URL', () => {
    const url = 'https://api.example.com:8080';
    expect(loadConfig({ DEVDIGEST_API_URL: url }).apiBaseUrl).toBe(url);
  });

  it('rejects a malformed DEVDIGEST_API_URL', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'not-a-url' })).toThrow(z.ZodError);
  });
});
