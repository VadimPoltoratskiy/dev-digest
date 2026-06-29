import type { CommunitySkillEntry } from '@devdigest/shared';

/** Hardcoded community skill catalog served by GET /skills/community. */
export const COMMUNITY_CATALOG: CommunitySkillEntry[] = [
  {
    name: 'owasp-top-10-review',
    repo: 'secdev/agent-skills',
    stars: 1240,
    lang: 'any',
    description: 'Maps diff changes to the OWASP Top 10 with CWE references.',
    tags: ['security', 'owasp'],
    body: `# OWASP Top 10 Review

Evaluate every changed file against the OWASP Top 10 (2021). For each issue found, cite the CWE number, the OWASP category, and the exact line in the diff.

## Categories to check
- A01 Broken Access Control
- A02 Cryptographic Failures
- A03 Injection (SQL, command, LDAP, XPath)
- A04 Insecure Design
- A05 Security Misconfiguration
- A06 Vulnerable and Outdated Components
- A07 Identification and Authentication Failures
- A08 Software and Data Integrity Failures
- A09 Security Logging and Monitoring Failures
- A10 Server-Side Request Forgery

Only flag confirmed or very-likely issues. Skip theoretical concerns.`,
  },
  {
    name: 'react-hooks-rules',
    repo: 'frontend-guild/skills',
    stars: 842,
    lang: 'TypeScript',
    description: 'Detects conditional hooks, missing deps, stale closures.',
    tags: ['frontend', 'react'],
    body: `# React Hooks Rules

Flag any violation of the Rules of Hooks and common hook misuse patterns.

## CRITICAL
- Hook called inside a condition, loop, or nested function
- Hook called outside a React function component or custom hook

## HIGH
- Missing dependency in useEffect/useCallback/useMemo dep array
- Stale closure capturing an old value of a ref or state setter
- useEffect with async function directly (should wrap inner async fn)

## MEDIUM
- useCallback or useMemo wrapping a cheap non-referential value
- Effect cleanup function missing when subscription or timer started`,
  },
  {
    name: 'sql-injection-gate',
    repo: 'secdev/agent-skills',
    stars: 690,
    lang: 'any',
    description: 'Flags string-concatenated SQL and unparameterized queries.',
    tags: ['security', 'sql'],
    body: `# SQL Injection Gate

Flag any SQL query that concatenates user-controlled input without parameterization.

## CRITICAL
- String interpolation or concatenation inside a SQL query
- Raw .query() / .execute() calls with template literals containing variables
- Dynamic ORDER BY / table name built from user input without allowlist

## HIGH
- ORM raw() escape hatch used without binding
- LIKE pattern built from user input without escaping

Cite the exact line and the input source (req.params, req.query, req.body).`,
  },
  {
    name: 'a11y-jsx-audit',
    repo: 'a11y-collective/skills',
    stars: 318,
    lang: 'TypeScript',
    description: 'Checks JSX for missing alt text, ARIA, and focus traps.',
    tags: ['frontend', 'a11y'],
    body: `# Accessibility JSX Audit

Check every changed JSX/TSX file for accessibility issues.

## CRITICAL
- <img> without alt attribute or alt=""  on informative image
- onClick on a non-interactive element with no keyboard handler
- Modal/dialog opened without focus trap or Escape key handler

## HIGH
- Missing aria-label on icon-only buttons
- Form inputs without associated <label> or aria-labelledby
- Colour contrast below 4.5:1 for normal text (cite the hex values)

## MEDIUM
- Heading levels skipped (h1 → h3)
- role="presentation" on interactive element`,
  },
  {
    name: 'no-console-log',
    repo: 'dx-guild/skills',
    stars: 512,
    lang: 'TypeScript',
    description: 'Flags console.log/debug left in production code.',
    tags: ['cleanup', 'dx'],
    body: `# No Console Log

Flag console.log, console.debug, or console.dir statements committed to non-test production code.

## HIGH
- console.log / console.debug / console.dir in src/ files outside *.test.* or *.spec.*
- console.warn / console.error in hot paths (per-request handlers, rendering functions)

Ignore intentional logging via structured loggers (pino, winston, logger.*).`,
  },
  {
    name: 'api-breaking-change',
    repo: 'platform-eng/skills',
    stars: 775,
    lang: 'any',
    description: 'Detects breaking API contract changes in route signatures.',
    tags: ['api', 'contracts'],
    body: `# API Breaking Change Detector

Identify changes that would break existing API consumers.

## CRITICAL
- Removing a required field from a response object
- Changing a field's type (string→number, object→array)
- Removing an existing route (DELETE method or path removal)
- Renaming a path parameter (:id → :userId)
- Changing an HTTP method for an existing route

## HIGH
- Making a previously optional field required in a request body
- Removing a previously accepted query parameter
- Narrowing an enum (removing valid values)

## MEDIUM
- Adding a new required header without a default
- Changing default values for optional fields`,
  },
  {
    name: 'drizzle-orm-patterns',
    repo: 'orm-guild/skills',
    stars: 430,
    lang: 'TypeScript',
    description: 'Enforces Drizzle ORM best practices for queries and migrations.',
    tags: ['database', 'drizzle'],
    body: `# Drizzle ORM Patterns

Flag anti-patterns in Drizzle ORM usage.

## CRITICAL
- Hand-edited SQL migration file (use db:generate only)
- Raw SQL string passed to db.execute() without $$ binding
- N+1 query inside a loop (db.select inside forEach/map)

## HIGH
- Missing .where() on .update() or .delete() (affects all rows)
- Selecting * with .select() instead of projecting needed columns on large tables
- Transaction rolled back silently via empty catch block

## MEDIUM
- Relation defined in query but not declared in schema relations()
- Missing index on foreign key column used in frequent joins`,
  },
  {
    name: 'secret-leakage-gate',
    repo: 'secdev/agent-skills',
    stars: 960,
    lang: 'any',
    description: 'Detects sk_live, service_role, and NEXT_PUBLIC_ secret patterns.',
    tags: ['security', 'secrets'],
    body: `# Secret Leakage Gate

Flag any hardcoded credentials, API keys, or tokens in the diff.

## CRITICAL
- sk_live_, sk_test_, rk_live_ Stripe patterns
- AKIA[A-Z0-9]{16} AWS access key pattern
- service_role or anon key for Supabase
- Private key PEM block (-----BEGIN)
- Password or secret assigned a literal string value
- NEXT_PUBLIC_ env var referencing a server-side secret

Flag the exact line and redact the value in your report. Never reproduce the full key.`,
  },
  {
    name: 'typescript-strict-nulls',
    repo: 'frontend-guild/skills',
    stars: 601,
    lang: 'TypeScript',
    description: 'Catches unguarded null dereferences and missing undefined checks.',
    tags: ['typescript', 'safety'],
    body: `# TypeScript Strict Nulls

Identify code that dereferences potentially null or undefined values without a guard.

## HIGH
- Optional chaining missing before property access on a value typed as T | undefined
- Non-null assertion (!) used on a value that could genuinely be null at runtime
- Array index access [0] without a length check or .at(0) ?? fallback
- Object destructuring without default on an optional field

## MEDIUM
- Return type annotation missing on exported function that can return undefined
- as T cast hiding a nullable type`,
  },
  {
    name: 'test-coverage-nudge',
    repo: 'quality-eng/skills',
    stars: 389,
    lang: 'any',
    description: 'Suggests tests when new branches lack assertions.',
    tags: ['testing', 'quality'],
    body: `# Test Coverage Nudge

Flag new code paths that lack corresponding test coverage.

## HIGH
- New exported function or class method with no test file referencing it
- New error/edge-case branch (catch block, early return, null guard) not exercised in tests
- New API route handler with no integration test

## MEDIUM
- Test file changed to delete assertions (snapshot update without reviewing content)
- Only happy-path tested for a function with multiple branching conditions

Do not flag untested private/internal utilities unless they contain critical logic.`,
  },
];

export function searchCatalog(
  q?: string,
  lang?: string,
  tag?: string,
  limit = 20,
): CommunitySkillEntry[] {
  let results = COMMUNITY_CATALOG;

  if (q) {
    const lower = q.toLowerCase();
    results = results.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  if (lang && lang !== 'any') {
    results = results.filter((s) => s.lang.toLowerCase() === lang.toLowerCase() || s.lang === 'any');
  }

  if (tag) {
    results = results.filter((s) => s.tags.includes(tag));
  }

  return results
    .sort((a, b) => b.stars - a.stars)
    .slice(0, limit);
}
