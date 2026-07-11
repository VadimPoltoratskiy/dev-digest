import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type GenerationKindMode = 'count' | 'must_find' | 'must_not_flag';

const MODE_INSTRUCTIONS: Record<GenerationKindMode, string> = {
  count:
    'Mode: COUNT. Draft a diff that should trigger a small number (1-3) of violations of the ' +
    'rubric. Set `expected_finding_count` to that number. Leave `kind`, `file`, `start_line`, ' +
    '`end_line`, and `title` null.',
  must_find:
    'Mode: MUST_FIND. Draft a diff containing exactly ONE clear violation of the rubric. Set ' +
    '`kind` to "must_find", `file` to the diff\'s file path, `start_line`/`end_line` to the line ' +
    'range (in the new file) where the violation lives, and `title` to a short name for that ' +
    'violation. Leave `expected_finding_count` null.',
  must_not_flag:
    'Mode: MUST_NOT_FLAG. Draft a compliant "near-miss" diff — code that looks superficially like ' +
    'it could violate the rubric but actually does not, so a careful reviewer applying the rubric ' +
    'should NOT flag it. Set `kind` to "must_not_flag", `file` to the diff\'s file path, ' +
    '`start_line`/`end_line` to the line range a naive reviewer might wrongly flag, and `title` to ' +
    'a short name for what a false positive would have called out. Leave `expected_finding_count` null.',
};

/** Builds the system + user messages for eval case generation. Pure — no I/O. */
export async function buildGenerationPrompt(params: {
  kindMode: GenerationKindMode;
  hint?: string;
  skill: { name: string; description: string; type: string; body: string };
}): Promise<{ system: string; user: string }> {
  const promptPath = fileURLToPath(new URL('../../prompts/eval-case-generation.system.md', import.meta.url));
  const template = await fs.readFile(promptPath, 'utf-8');
  const system = template.replace('{{mode_instructions}}', MODE_INSTRUCTIONS[params.kindMode]);

  const parts: string[] = [
    `Skill name: ${params.skill.name}`,
    `Skill type: ${params.skill.type}`,
    `Skill description: ${params.skill.description}`,
    `Rubric body:\n<untrusted>\n${params.skill.body}\n</untrusted>`,
  ];
  if (params.hint?.trim()) {
    parts.push(`User hint (optional guidance for the scenario):\n<untrusted>\n${params.hint.trim()}\n</untrusted>`);
  }
  return { system, user: parts.join('\n\n') };
}

/**
 * Pure post-generation validation — no DB, no LLM. Returns an error message if the LLM's
 * output doesn't satisfy the shape a given mode requires, else null.
 */
export function validateGeneratedCase(
  kindMode: GenerationKindMode,
  draft: { input_diff: string; file?: string | null; start_line?: number | null; end_line?: number | null },
): string | null {
  if (!draft.input_diff.includes('@@')) {
    return 'Generated output is missing a valid diff hunk (@@ marker).';
  }
  if (kindMode !== 'count' && (!draft.file?.trim() || draft.start_line == null || draft.end_line == null)) {
    return `Generated output for mode "${kindMode}" is missing file/start_line/end_line.`;
  }
  return null;
}
