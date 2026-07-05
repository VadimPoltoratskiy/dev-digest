import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keyFromEnvFiles } from './secrets.js';

describe('keyFromEnvFiles', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'devdigest-env-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  it('reads a plain KEY=VALUE line', () => {
    const f = write('.env', 'OPENROUTER_API_KEY=sk-or-abc\n');
    expect(keyFromEnvFiles('OPENROUTER_API_KEY', [f])).toBe('sk-or-abc');
  });

  it('ignores comments, blank lines, other keys, and strips quotes + export', () => {
    const f = write(
      '.env',
      ['# comment', '', 'OTHER=nope', 'export OPENROUTER_API_KEY="sk-or-quoted"'].join('\n'),
    );
    expect(keyFromEnvFiles('OPENROUTER_API_KEY', [f])).toBe('sk-or-quoted');
  });

  it('returns the value from the first file that has it (precedence order)', () => {
    const rootEnv = write('root.env', 'OPENROUTER_API_KEY=from-root\n');
    const serverEnv = write('server.env', 'OPENROUTER_API_KEY=from-server\n');
    expect(keyFromEnvFiles('OPENROUTER_API_KEY', [rootEnv, serverEnv])).toBe('from-root');
  });

  it('falls through to the next file when the first lacks the key or is missing', () => {
    const missing = join(dir, 'does-not-exist.env');
    const serverEnv = write('server.env', 'OPENROUTER_API_KEY=from-server\n');
    expect(keyFromEnvFiles('OPENROUTER_API_KEY', [missing, serverEnv])).toBe('from-server');
  });

  it('returns undefined when no file has the key', () => {
    const f = write('.env', 'OTHER=1\n');
    expect(keyFromEnvFiles('OPENROUTER_API_KEY', [f])).toBeUndefined();
  });
});
