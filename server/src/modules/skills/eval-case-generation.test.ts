import { describe, it, expect, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readFile: vi.fn().mockResolvedValue('Draft a case.\n\n{{mode_instructions}}\n\nDone.'),
  };
});

import { buildGenerationPrompt, validateGeneratedCase } from './eval-case-generation.js';

const SKILL = { name: 'No hardcoded secrets', description: 'Flags hardcoded credentials.', type: 'security', body: 'Never commit API keys or tokens as string literals.' };

describe('buildGenerationPrompt', () => {
  it('substitutes {{mode_instructions}} with mode-specific guidance for each kindMode', async () => {
    const { system: countSystem } = await buildGenerationPrompt({ kindMode: 'count', skill: SKILL });
    const { system: mustFindSystem } = await buildGenerationPrompt({ kindMode: 'must_find', skill: SKILL });
    const { system: mustNotFlagSystem } = await buildGenerationPrompt({ kindMode: 'must_not_flag', skill: SKILL });

    expect(countSystem).toContain('Mode: COUNT');
    expect(mustFindSystem).toContain('Mode: MUST_FIND');
    expect(mustNotFlagSystem).toContain('Mode: MUST_NOT_FLAG');
    expect(countSystem).not.toContain('{{mode_instructions}}');
  });

  it('embeds the skill name/type/description/body in the user message, wrapped as untrusted', async () => {
    const { user } = await buildGenerationPrompt({ kindMode: 'count', skill: SKILL });

    expect(user).toContain(SKILL.name);
    expect(user).toContain(SKILL.type);
    expect(user).toContain(SKILL.description);
    expect(user).toContain('<untrusted>');
    expect(user).toContain(SKILL.body);
  });

  it('includes an optional hint (also wrapped as untrusted) only when provided', async () => {
    const withHint = await buildGenerationPrompt({ kindMode: 'count', hint: 'focus on env files', skill: SKILL });
    const withoutHint = await buildGenerationPrompt({ kindMode: 'count', skill: SKILL });

    expect(withHint.user).toContain('focus on env files');
    expect(withoutHint.user).not.toContain('User hint');
  });
});

describe('validateGeneratedCase', () => {
  it('rejects a diff with no @@ hunk marker regardless of mode', () => {
    expect(validateGeneratedCase('count', { input_diff: '--- a/x\n+++ b/x\nno hunk here' })).not.toBeNull();
  });

  it('accepts a count-mode draft with just a valid diff (no file/line required)', () => {
    expect(validateGeneratedCase('count', { input_diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n+x' })).toBeNull();
  });

  it('rejects a must_find draft missing file/start_line/end_line', () => {
    const draft = { input_diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n+x' };
    expect(validateGeneratedCase('must_find', draft)).not.toBeNull();
  });

  it('accepts a must_not_flag draft with file/start_line/end_line all present', () => {
    const draft = {
      input_diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n+x',
      file: 'src/x.ts',
      start_line: 1,
      end_line: 1,
    };
    expect(validateGeneratedCase('must_not_flag', draft)).toBeNull();
  });
});
