import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL } from './agent.js';
import { parseArgs } from './index.js';

describe('parseArgs', () => {
  it('applies defaults for `review` with no flags', () => {
    expect(parseArgs(['review'])).toEqual({
      mode: 'working',
      agent: 'general',
      model: DEFAULT_MODEL,
      failOn: 'critical',
    });
  });

  it('parses space-separated flags', () => {
    const args = parseArgs(['review', '--mode', 'working', '--agent', 'security', '--fail-on', 'any', '--model', 'x/y']);
    expect(args).toEqual({ mode: 'working', agent: 'security', model: 'x/y', failOn: 'any' });
  });

  it('parses --flag=value form', () => {
    const args = parseArgs(['review', '--agent=performance', '--fail-on=warning']);
    expect(args.agent).toBe('performance');
    expect(args.failOn).toBe('warning');
  });

  it('rejects a missing/unknown command', () => {
    expect(() => parseArgs([])).toThrow(/command/i);
    expect(() => parseArgs(['bogus'])).toThrow(/Unknown command/);
  });

  it('rejects unknown options and invalid enum values', () => {
    expect(() => parseArgs(['review', '--nope'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['review', '--mode', 'sideways'])).toThrow(/--mode must be one of/);
    expect(() => parseArgs(['review', '--agent', 'nobody'])).toThrow(/--agent must be one of/);
    expect(() => parseArgs(['review', '--fail-on', 'sometimes'])).toThrow(/--fail-on must be one of/);
  });

  it('accepts the reserved modes at the parser level (getDiff gates them at runtime)', () => {
    expect(parseArgs(['review', '--mode', 'staged']).mode).toBe('staged');
  });
});
