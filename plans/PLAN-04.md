# Plan: Remove CI Integration from Target Repository (SPEC-04)

## Spec reference
`specs/SPEC-04-remove-from-ci.md` (approved)

## Execution mode: single-agent

SPEC-04 is a vertically stacked feature: adapter interface → adapter implementation → shared Zod contracts → service method → route → client API → client hook → dialog component. Each layer depends on the output of the layer below it. Splitting into parallel phases would require each implementer to work against stub interfaces that don't yet exist, producing more coordination overhead than any theoretical parallelism gain. The entire feature touches approximately 12 files across two packages — well within the scope of one implementer working top-down.

## Goal

Today, `DELETE /agents/:id/ci-installations/:installationId` deletes only DevDigest's local `ci_installations` row; the GitHub Actions workflow and `.devdigest/**` config files remain in the target repository forever. This plan adds a new repo-mutating removal path (`POST /agents/:id/ci-installations/:installationId/remove-from-repo`) that commits a deletion tree to a `devdigest/ci-remove` branch and opens a human-reviewed PR, mirroring the add-flow's non-destructive, human-in-the-loop philosophy from SPEC-03. On the client, the existing `window.confirm` block in `CiTab.tsx` is replaced by a two-action modal dialog that also preserves the local-record-only "Stop tracking only" escape hatch.

## Modules affected

- `server/` — adapters layer (`GitHubClient` interface + `OctokitGitHubClient` + `MockGitHubClient`), shared Zod contracts, `ci` module helpers/service/routes, adapter tests, service tests
- `client/` — vendor/shared contract mirror, `lib/api.ts`, `lib/hooks/ci.ts`, `CiTab` (new `RemovalDialog` colocated), `messages/en/agents.json`

## Engineering Insights applied

- **Both vendor/shared copies must be updated in lockstep**: `server/src/vendor/shared/contracts/eval-ci.ts` and `client/src/vendor/shared/contracts/eval-ci.ts` are a manual mirror — tsc is the only gatekeeper. Both must receive `CiRemoveInput` and `CiRemoval` in the same change.
- **Zod contract additions use `.optional()` not `.nullish()` for user-supplied optional fields**: `CiRemoveInput.base` is a user-supplied optional field (never explicitly set to `null`), so `.optional()` is correct. `CiRemoval.pr_url` is always populated on success — `z.string()` (not `.nullable()`).
- **`MockGitHubClient` must implement every `GitHubClient` method**: Adding `deleteFiles` and `getDefaultBranch` to the interface breaks the mock at compile time. Both must be added to `mocks.ts` with tracking arrays before any service test can pass.
- **Services use the DI container for adapters**: `this.container.github()` is the correct call site; importing `OctokitGitHubClient` directly in a service is a layer violation per onion-architecture rules.
- **Rate limit for new route**: network-bound GitHub API work → `max: 6, timeWindow: '1 minute'` (same cap as `POST /ci/runs/refresh`).
- **Test fixtures for `CiTab.test.tsx`**: the existing test spies on `window.confirm`. That spy must be removed and replaced with dialog-interaction assertions.

## Recommendations

- **Separate `getDefaultBranch` method rather than modifying `checkWriteAccess`**: Both call `octokit.rest.repos.get()`, but combining them would change `checkWriteAccess`'s return type and break every call site that only needs the boolean. The extra API call per removal is within the 30-second performance budget and the code stays clean.
- **`z.string().min(1).optional()` for `CiRemoveInput.base`**: `.optional()` alone permits empty strings; `.min(1)` enforces the spec's "rejected with 422 if present but empty" requirement at the Zod level rather than in the route handler.

## Architecture decisions

**New `deleteFiles` method on `GitHubClient` (not a variant of `CommitFilesPayload`):** File-content additions and file-path deletions are distinct Git tree operations. `DeleteFilesPayload` (`branch`, `base`, `message`, `paths: string[]`) is cleaner and safer than overloading `CommitFilesPayload` with nullable `sha` sentinels. Per onion-architecture adapter interface rules.

**`buildCiFilePaths` helper extracted from `buildCiBundle` (AC-9 guarantee):** AC-9 requires the deletion path list to exactly mirror the 5 categories `buildCiBundle` defines. The reliable way to enforce this is a shared `buildCiFilePaths({ slug, skillSlugs })` pure function that both `buildCiBundle` and `removeCiFromRepo` call. Hand-duplicating the list in two places is an AC-9 violation waiting to happen on the next skill category change.

**`RemovalDialog` colocated in `CiTab/` as sibling files (not a third-level `_components/`):** Per ui-architecture, nesting is capped at two `_components/` levels. `CiTab/` is already at the second level under `AgentEditor/_components/`. `RemovalDialog.tsx` and `RemovalDialog.test.tsx` are placed as siblings inside the existing `CiTab/` folder without creating a new `_components/` subfolder.

**`triggerRef` in `CiTab` for focus return on dialog close:** Multiple "Remove" buttons exist (one per installation). A single `triggerRef = useRef<HTMLButtonElement | null>(null)` in `CiTab` is assigned `e.currentTarget` in the click handler. The `handleDialogClose` callback calls `triggerRef.current?.focus()` before clearing `dialogInstallation`. Per react-best-practices accessibility rules.

**Escape key + focus trap in `RemovalDialog` (vendor `Modal` has no keyboard management):** Two `useEffect` hooks: one for Escape (`document.addEventListener('keydown', ...)` scoped to open state), one for Tab focus trapping within the dialog container ref. The second effect has no dependency array — intentional, so it re-queries focusable elements after async content (preflight result) changes the DOM.

**`useCiPreflight` reused without modification:** The hook at `hooks/ci.ts` already queries `GET /ci/preflight` and returns `{ has_write_access, secrets }`. `RemovalDialog` calls `useCiPreflight(repo)` only when `installation.target_type === 'gha'`, gating the "Open removal PR" button on `data?.has_write_access === true`.

**`deleteInstallation` called AFTER GitHub API success (AC-7 fail-closed):** A 403 from `deleteFiles` or any other GitHub call throws `ValidationError(422)` before `repo.deleteInstallation()` is reached. The local row survives on any error.

## Tasks

### Step 1 — Shared Zod contracts (both vendor copies)

- [ ] `server/src/vendor/shared/contracts/eval-ci.ts` — Add after the `CiExport` export block (backward-compatible additions; no existing fields touched):
  ```typescript
  /** Request body for POST /agents/:id/ci-installations/:installationId/remove-from-repo */
  export const CiRemoveInput = z.object({
    base: z.string().min(1).optional(),
  });
  export type CiRemoveInput = z.infer<typeof CiRemoveInput>;

  /** Response of POST /agents/:id/ci-installations/:installationId/remove-from-repo */
  export const CiRemoval = z.object({
    pr_url: z.string(),
  });
  export type CiRemoval = z.infer<typeof CiRemoval>;
  ```

- [ ] `client/src/vendor/shared/contracts/eval-ci.ts` — Identical additions (manual mirror). The barrel `client/src/vendor/shared/index.ts` already re-exports from `eval-ci` — no change needed there.

### Step 2 — GitHub adapter interface

- [ ] `server/src/vendor/shared/adapters.ts` — Add `DeleteFilesPayload` interface after `CommitFilesPayload`:
  ```typescript
  /** Payload for a deletion commit: removes existing repo paths; no file contents needed. */
  export interface DeleteFilesPayload {
    /** Branch to create-or-update with the deletion commit (e.g. "devdigest/ci-remove"). */
    branch: string;
    /** Base branch to fork from when `branch` does not yet exist (e.g. "main"). */
    base: string;
    message: string;
    /**
     * Repo-relative paths to delete. Paths absent from the base tree are silently
     * ignored by the GitHub Trees API (edge case 2 in SPEC-04).
     */
    paths: string[];
  }
  ```
  Add two methods to `GitHubClient` interface (after `commitFiles`/`findOpenPr`):
  ```typescript
  /**
   * Commit a deletion of `paths` onto `branch` as ONE atomic commit (Git Data API:
   * null-SHA tree entries → commit → ref). Creates `branch` from `base` if missing,
   * else fast-forwards it. Paths not present in the base tree are silently ignored.
   */
  deleteFiles(repo: RepoRef, payload: DeleteFilesPayload): Promise<{ branch: string }>;
  /** Fetch the repository's default branch name (e.g. "main" or "master"). */
  getDefaultBranch(repo: RepoRef): Promise<string>;
  ```

### Step 3 — `OctokitGitHubClient` implementation

- [ ] `server/src/adapters/github/octokit.ts` — Implement `deleteFiles` on `OctokitGitHubClient`. Mirror the structure of `commitFiles` exactly:
  1. Get parent SHA: try `g.getRef({ ref: \`heads/${payload.branch}\` })` (branch exists); on error, fall back to `g.getRef({ ref: \`heads/${payload.base}\` })` and mark `branchExists = false`.
  2. Get parent commit's tree SHA: `g.getCommit({ commit_sha: parentSha })`.
  3. Create deletion tree: `g.createTree({ base_tree: parentCommit.data.tree.sha, tree: payload.paths.map(path => ({ path, mode: '100644', type: 'blob', sha: null })) })`. If TypeScript rejects `sha: null`, use `sha: null as string | null`.
  4. Create commit: `g.createCommit({ message, tree: tree.data.sha, parents: [parentSha] })`.
  5. Create-or-update ref (same `branchExists` conditional as `commitFiles`).
  6. Return `{ branch: payload.branch }`.
  7. Wrap entire body in `withRetry(() => withTimeout((async () => { ... })(), TIMEOUT))`.

  Implement `getDefaultBranch`:
  ```typescript
  async getDefaultBranch(repo: RepoRef): Promise<string> {
    const res = await withTimeout(
      this.octokit.rest.repos.get({ owner: repo.owner, repo: repo.name }),
      TIMEOUT,
    );
    return res.data.default_branch;
  }
  ```

### Step 4 — `MockGitHubClient`

- [ ] `server/src/adapters/mocks.ts` — Import `DeleteFilesPayload` from `@devdigest/shared`. Add to `MockGitHubClient`:
  ```typescript
  public deletedFiles: DeleteFilesPayload[] = [];

  async deleteFiles(_repo: RepoRef, payload: DeleteFilesPayload): Promise<{ branch: string }> {
    this.deletedFiles.push(payload);
    return { branch: payload.branch };
  }

  async getDefaultBranch(_repo: RepoRef): Promise<string> {
    return 'main';
  }
  ```

### Step 5 — Adapter tests

- [ ] `server/src/adapters/github/octokit.test.ts` — Add a second `describe` block following the existing `getPullRequest` test's vi.mock + spy pattern:

  `describe('OctokitGitHubClient.deleteFiles')`:
  - Mock `g.getRef` to return `{ data: { object: { sha: 'parent-sha' } } }` (branch exists).
  - Mock `g.getCommit` to return `{ data: { tree: { sha: 'base-tree-sha' } } }`.
  - Mock `g.createTree` to return `{ data: { sha: 'new-tree-sha' } }`.
  - Mock `g.createCommit` to return `{ data: { sha: 'new-commit-sha' } }`.
  - Mock `g.updateRef` (branch exists path).
  - Assert `createTree` was called with a `tree` array where every entry has `sha: null`.
  - Assert `updateRef` was called (not `createRef`) when branch exists.
  - Second test: `getRef` throws → falls back to base branch `getRef`, calls `createRef` (not `updateRef`).

  `describe('OctokitGitHubClient.getDefaultBranch')`:
  - Mock `octokit.rest.repos.get` to return `{ data: { default_branch: 'trunk' } }`.
  - Assert return value is `'trunk'`.

### Step 6 — Helpers refactor

- [ ] `server/src/modules/ci/helpers.ts` — Add `buildCiFilePaths` before `buildCiBundle`:
  ```typescript
  /**
   * Canonical list of DevDigest-managed repo paths for a given agent slug + skill slugs.
   * Called by both buildCiBundle (add-flow) and removeCiFromRepo (removal flow)
   * to guarantee the deletion PR deletes exactly what was added (AC-9).
   */
  export function buildCiFilePaths(params: {
    slug: string;
    skillSlugs: string[];
  }): string[] {
    const { slug, skillSlugs } = params;
    return [
      `.devdigest/agents/${slug}.yaml`,
      ...skillSlugs.map((s) => `.devdigest/skills/${s}.md`),
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ];
  }
  ```
  Refactor `buildCiBundle` to derive its file `path` values from `buildCiFilePaths` (so the two path lists can never diverge). Verify existing tests do not break — the path order and values are unchanged.

### Step 7 — Service method

- [ ] `server/src/modules/ci/service.ts` — Import `CiRemoval` from `@devdigest/shared`. Import `buildCiFilePaths` from `./helpers.js`. Add `removeCiFromRepo` to `CiService` immediately after `removeCiInstallation`:

  ```typescript
  /**
   * Remove CI integration from the target repository (SPEC-04 AC-3 through AC-7).
   *
   * Opens a deletion PR on `devdigest/ci-remove`; deletes the local ci_installations
   * row only after GitHub API success — fail-closed on 403 (AC-7).
   * ci_runs rows are NOT deleted; FK ON DELETE SET NULL nulls ci_installation_id.
   */
  async removeCiFromRepo(
    agentId: string,
    installationId: string,
    workspaceId: string,
    base?: string,
  ): Promise<CiRemoval> {
    const repo = new CiRepository(this.container.db);

    // 1. Ownership verification — 404 on any mismatch (edge case 6 in spec)
    const installation = await repo.findInstallationById(installationId);
    if (!installation || installation.agentId !== agentId) {
      throw new NotFoundError('CI installation not found');
    }
    const agent = await repo.findAgentById(agentId);
    if (!agent || agent.workspaceId !== workspaceId) {
      throw new NotFoundError('CI installation not found');
    }

    // 2. Build deletion path list — same 5 categories as buildCiBundle (AC-9)
    const skills = await repo.findSkillsByAgentId(agentId);
    const slug = agentSlug(agent.name);
    const skillSlugs = skills.map((s) => agentSlug(s.name));
    const paths = buildCiFilePaths({ slug, skillSlugs });

    // 3. Resolve base branch (AC-3: auto-detect when not supplied)
    const repoRef = parseRepoRef(installation.repo);
    const github = await this.container.github();
    const resolvedBase = base ?? (await github.getDefaultBranch(repoRef));

    // 4. Check for existing open PR — reuse URL rather than open duplicate (AC-4)
    const existingPr = await github.findOpenPr(repoRef, 'devdigest/ci-remove');

    // 5. Commit deletion tree — 403 → 422, local row NOT deleted (AC-7)
    try {
      await github.deleteFiles(repoRef, {
        branch: 'devdigest/ci-remove',
        base: resolvedBase,
        message: `chore: remove DevDigest agent "${agent.name}" from CI`,
        paths,
      });
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 403) {
        throw new ValidationError(
          'GitHub token lacks write access to this repository',
          422,
        );
      }
      throw err;
    }

    // 6. Open PR or reuse existing URL (AC-4)
    let prUrl: string;
    if (existingPr) {
      prUrl = existingPr.url;
    } else {
      const newPr = await github.openPullRequest(repoRef, {
        title: `Remove DevDigest CI: ${installation.repo}`,
        head: 'devdigest/ci-remove',
        base: resolvedBase,
        body: [
          `This PR removes the DevDigest CI integration from this repository.`,
          '',
          'Review the file deletions and merge to complete the cleanup.',
          '',
          '> Opened by [DevDigest](https://github.com/devdigest).',
        ].join('\n'),
      });
      prUrl = newPr.url;
    }

    // 7. Delete local record AFTER GitHub success (AC-5, AC-7)
    await repo.deleteInstallation(installationId);

    return { pr_url: prUrl };
  }
  ```

### Step 8 — Route

- [ ] `server/src/modules/ci/routes.ts` — Add `CiRemoveInput` to the `@devdigest/shared` import line. Add the new route after the `DELETE` route and before the `POST /ci/runs/refresh` registration. Also update the JSDoc comment listing at the top of `ciRoutes`.

  ```typescript
  // -------------------------------------------------------------------------
  // POST /agents/:id/ci-installations/:installationId/remove-from-repo
  // -------------------------------------------------------------------------
  app.post(
    '/agents/:id/ci-installations/:installationId/remove-from-repo',
    {
      schema: {
        params: CiInstallationParams,  // validates both UUIDs (already defined)
        body: CiRemoveInput,
      },
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.removeCiFromRepo(
        req.params.id,
        req.params.installationId,
        workspaceId,
        req.body.base,
      );
    },
  );
  ```

### Step 9 — Service tests

- [ ] `server/src/modules/ci/service.test.ts` — Create if it does not exist; otherwise add a new `describe('CiService.removeCiFromRepo')` block. Use `MockGitHubClient` and the existing integration-test DB setup pattern (or a vitest unit mock of `CiRepository`). Cover:
  - **Happy path (no existing PR)**: `deletedFiles` has one entry with the correct paths; `openedPrs` has one entry; `deleteInstallation` was called; return value matches `{ pr_url: 'https://...' }`.
  - **AC-4 (existing PR reused)**: pre-populate `mockGithub.openedPrs` with `head: 'devdigest/ci-remove'` → `findOpenPr` returns a URL → `openPullRequest` is NOT called.
  - **AC-5 (zero linked skills)**: `skillSlugs = []` → `paths` contains 4 entries (no skill files) → commit proceeds.
  - **AC-7 (403 → 422)**: `deleteFiles` throws `{ status: 403 }` → service throws `ValidationError(422)` → `deleteInstallation` is NOT called.
  - **404 on unknown installation**: `findInstallationById` returns null → `NotFoundError`.
  - **404 on workspace mismatch**: agent exists but `agent.workspaceId !== workspaceId` → `NotFoundError`.
  - **Base auto-detect**: `base` param is `undefined` → `getDefaultBranch` is called → its return value (`'main'` from mock) is passed to `deleteFiles` and `openPullRequest`.

### Step 10 — Client API function

- [ ] `client/src/lib/api.ts` — Import `CiRemoval` from `@devdigest/shared`. Add after `removeCiInstallation`:
  ```typescript
  /**
   * Open a deletion PR in the target repository for a CI installation (SPEC-04).
   * Deletes the local ci_installations row on success.
   * Returns 422 when the GitHub token lacks write access (AC-7).
   */
  export function removeCiFromRepo(
    agentId: string,
    installationId: string,
    body: { base?: string },
  ): Promise<CiRemoval> {
    return api.post<CiRemoval>(
      `/agents/${agentId}/ci-installations/${installationId}/remove-from-repo`,
      body,
    );
  }
  ```

### Step 11 — Client hook

- [ ] `client/src/lib/hooks/ci.ts` — Import `removeCiFromRepo` from `../api`. Add:
  ```typescript
  /** Mutation: open a deletion PR in the target repo and remove the local installation record. */
  export function useRemoveCiFromRepo(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({
        installationId,
        base,
      }: {
        installationId: string;
        base?: string;
      }) => removeCiFromRepo(agentId, installationId, { base }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['ci-installations', agentId] });
        qc.invalidateQueries({ queryKey: ['ci-runs'] });
      },
    });
  }
  ```

### Step 12 — `RemovalDialog` component

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/RemovalDialog.tsx` — New file. Full component implementation:

  **Imports:** `Modal` from `@devdigest/ui`, `useTranslations` from `next-intl`, `useCiPreflight`, `useRemoveCiInstallation`, `useRemoveCiFromRepo` from `lib/hooks`, `CiInstallation` type from `@devdigest/shared`.

  **Props:**
  ```typescript
  interface RemovalDialogProps {
    agentId: string;
    installation: CiInstallation;
    onClose: () => void;  // caller handles focus return
  }
  ```

  **State:**
  - `prUrl: string | null` — set on "Open removal PR" success (shows PR link; keeps dialog open until user clicks Close)
  - `error: string | null` — inline error message from either mutation

  **Preflight (AC-2):**
  ```typescript
  const isGha = installation.target_type === 'gha';
  const { data: preflight, isLoading: preflightLoading } = useCiPreflight(
    isGha ? installation.repo : null,
  );
  const canOpenPr = isGha && preflight?.has_write_access === true && !preflightLoading;
  ```

  **Keyboard management (accessibility AC) — two `useEffect` hooks:**

  Effect 1 (Escape key, depends on `[onClose]`):
  ```typescript
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  ```

  Effect 2 (focus trap, no dependency array — re-queries DOM after async content changes):
  ```typescript
  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    focusable[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  });
  ```

  **Render structure inside `<Modal title={...} onClose={onClose} width={480}>`:**
  - Outer `<div ref={dialogRef}>` (focus trap container)
  - Dialog description (behavioral difference between the two actions)
  - Skill drift note (always shown when `isGha`): `{t('ci.removeDialog.skillDriftNote')}`
  - Non-GHA note (when `!isGha`): `{t('ci.removeDialog.nonGhaNote')}`
  - Access denied note (when `isGha && preflight?.has_write_access === false`): `{t('ci.removeDialog.noWriteAccess')}`
  - Inline `error` if set
  - **Success state** (when `prUrl` is set): `<a href={prUrl}>` + Close button
  - **Action buttons** (when `!prUrl`):
    - "Open removal PR": shown only when `isGha`; disabled when `!canOpenPr || removeFromRepo.isPending`; calls `removeFromRepo.mutate({ installationId: installation.id })` → on success sets `prUrl`; on error sets `error`
    - "Stop tracking only": always shown; disabled when `stopTracking.isPending`; calls `stopTracking.mutate(installation.id)` → on success calls `onClose()`; on error sets `error`

  **Mutations:**
  ```typescript
  const removeFromRepo = useRemoveCiFromRepo(agentId);
  const stopTracking = useRemoveCiInstallation(agentId);
  ```
  Wire `onSuccess`/`onError` in the `mutate` call options (not in the hook) so the dialog can set local state.

### Step 13 — Update `CiTab`

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx`:

  1. Import `RemovalDialog` from `'./RemovalDialog'`. Import `CiInstallation` from `@devdigest/shared` (or it may already be inferred from the `installations` hook data type).
  2. Remove `useRemoveCiInstallation` from the import list and its usage (`const removeInstallation = useRemoveCiInstallation(agentId)` — now called inside `RemovalDialog`).
  3. Remove `handleRemove` function (the `window.confirm` block).
  4. Add state:
     ```typescript
     const [dialogInstallation, setDialogInstallation] = React.useState<CiInstallation | null>(null);
     const triggerRef = React.useRef<HTMLButtonElement | null>(null);
     ```
  5. Add handler:
     ```typescript
     const handleRemoveClick = (
       inst: CiInstallation,
       e: React.MouseEvent<HTMLButtonElement>,
     ) => {
       triggerRef.current = e.currentTarget;
       setDialogInstallation(inst);
     };
     ```
  6. Add close callback:
     ```typescript
     const handleDialogClose = React.useCallback(() => {
       setDialogInstallation(null);
       triggerRef.current?.focus();
     }, []);
     ```
  7. Replace the "Remove" button `onClick` in the `installations.map()`:
     ```tsx
     <Button
       kind="ghost"
       size="sm"
       icon="Trash"
       onClick={(e) => handleRemoveClick(inst, e)}
     >
       {t('ci.remove')}
     </Button>
     ```
     Remove the `disabled={removeInstallation.isPending}` prop.
  8. Render `RemovalDialog` after `ExportWizard`:
     ```tsx
     {dialogInstallation && (
       <RemovalDialog
         agentId={agentId}
         installation={dialogInstallation}
         onClose={handleDialogClose}
       />
     )}
     ```

### Step 14 — i18n messages

- [ ] `client/messages/en/agents.json` — Under the `ci` object:
  1. **Remove** the `removeConfirm` key (replaced by dialog; leaving it orphaned produces dead translation keys).
  2. **Add** a `removeDialog` sub-object:
     ```json
     "removeDialog": {
       "title": "Remove \"{repo}\" from CI",
       "openPrBtn": "Open removal PR",
       "openPrDescription": "Opens a pull request on the target repository that deletes all DevDigest-managed files when merged. The local tracking record is removed immediately.",
       "stopTrackingBtn": "Stop tracking only",
       "stopTrackingDescription": "Removes DevDigest's local record only. The workflow and config files remain in the target repository and keep running until you delete them there.",
       "noWriteAccess": "DevDigest does not have write access to this repository. Use \"Stop tracking only\", or grant write access first.",
       "nonGhaNote": "This is not a GitHub Actions installation. Use \"Stop tracking only\" — non-GitHub-Actions CI systems must be cleaned up manually in the target CI platform.",
       "skillDriftNote": "Note: skills unlinked from this agent since the original export will not appear in the deletion PR. Audit .devdigest/skills/ manually if a complete cleanup is needed.",
       "prSuccess": "Removal PR opened:",
       "prView": "View PR"
     }
     ```

### Step 15 — Client tests

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/RemovalDialog.test.tsx` — New RTL test file. Mock all hooks via `vi.mock` on the hooks barrel. Cover:
  - **GHA with write access**: renders "Open removal PR" (enabled) and "Stop tracking only" buttons; skill drift note is visible.
  - **GHA without write access (AC-2)**: "Open removal PR" is disabled; access-denied message is visible; "Stop tracking only" is enabled.
  - **GHA, preflight still loading**: "Open removal PR" is disabled while `isLoading: true`.
  - **Non-GHA (AC-8)**: "Open removal PR" is not in the DOM; non-GHA note is visible; "Stop tracking only" is present.
  - **Escape key (accessibility)**: simulate `keydown` Escape event on `document` → `onClose` is called; neither mutation was invoked.
  - **"Stop tracking only" success**: mutation fires → `onClose` is called.
  - **"Open removal PR" success**: mutation fires → `prUrl` is set → PR link rendered; "Open removal PR" button hidden; Close button calls `onClose`.
  - **"Open removal PR" error (422)**: mutation rejects → error message shown inline; dialog remains open.

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx` — Update existing test:
  - Remove any `vi.spyOn(window, 'confirm')` setup.
  - Add test: clicking the "Remove" button on an installation row mounts `RemovalDialog` (assert `screen.getByRole('dialog')` is present after click).
  - Add test: before clicking "Remove", `RemovalDialog` is not in DOM.

## Gotchas

- **No DB migration required.** The spec's non-goals explicitly state "No new `ci_installations` database columns." Do not run `pnpm db:generate` or `pnpm db:migrate` for this feature.
- **`server/src/vendor/shared/` and `client/src/vendor/shared/` must be updated in lockstep.** tsc will catch a mismatch but only when each package is type-checked. Always update both in the same set of edits.
- **`sha: null` in Octokit tree entries.** The GitHub Trees API accepts `sha: null` to delete a path. If the Octokit TypeScript types reject `sha: null` as a raw null, cast as `sha: null as string | null`. Do not pass `sha: undefined` — that is semantically different (undefined is treated as "no sha" rather than "delete this path").
- **`Modal` vendor primitive has no `aria-labelledby`.** Do not modify `client/src/vendor/ui/kit/Modal.tsx`. The dialog's accessible name is satisfied by the visible `title` prop rendered in the modal header.
- **Focus trap effect has no dependency array.** This is intentional — the effect must re-query focusable elements whenever async content (preflight response) changes the DOM. If this causes visible re-focus flicker in tests, you may add `[prUrl, canOpenPr]` as deps after confirming the behavior is correct.
- **Route registration order in `routes.ts`.** The new POST route with a static suffix (`/remove-from-repo`) after the parametric `:installationId` is unambiguous to Fastify (different method from DELETE, extra path segment). No registration-order concern applies — unlike the `refresh`-vs-`:id` conflict documented for `ci/runs`.
- **`removeInstallation` variable removal from `CiTab`.** After Step 13, the `useRemoveCiInstallation(agentId)` call in `CiTab.tsx` is no longer needed there (the hook is called inside `RemovalDialog` instead). Remove the call and its variable to avoid an unused-variable TypeScript error — the hook import line may also need updating.
- **`ci.removeConfirm` removal.** The existing `CiTab.test.tsx` may reference `removeConfirm` as a spy-on string. Search the test file for `removeConfirm` and remove those references alongside the `window.confirm` spy setup.

## Definition of done

- [ ] `cd server && pnpm typecheck` — no errors
- [ ] `cd server && pnpm test` — all tests pass (new adapter tests in `octokit.test.ts` + service tests in `service.test.ts`)
- [ ] `cd client && pnpm typecheck` — no errors
- [ ] `cd client && pnpm test` — all tests pass (new `RemovalDialog.test.tsx` + updated `CiTab.test.tsx`)
- [ ] AC-1: clicking "Remove" on a CI installation row shows a modal dialog (not `window.confirm`) with both "Open removal PR" and "Stop tracking only" named actions
- [ ] AC-2: "Open removal PR" is disabled with explanatory text when `GET /ci/preflight` returns `has_write_access: false` for a GHA installation
- [ ] AC-3: `POST .../remove-from-repo` commits a deletion tree to `devdigest/ci-remove` targeting the repo's default branch (or the supplied `base`); the PR diff contains exactly the 5 DevDigest-managed path categories and nothing else
- [ ] AC-4: a second call when a `devdigest/ci-remove` PR is already open returns the existing PR URL without opening a duplicate
- [ ] AC-5: after "Open removal PR" succeeds, the `ci_installations` row is absent from DB; all linked `ci_runs` rows survive with `ci_installation_id = null`
- [ ] AC-6: "Stop tracking only" calls `DELETE /agents/:id/ci-installations/:installationId` (unchanged), row disappears from the UI, no GitHub API calls made
- [ ] AC-7: a 403 from the GitHub API produces a 422 HTTP response and leaves the `ci_installations` row intact in the DB
- [ ] AC-8: for non-GHA installations, "Open removal PR" is absent from the dialog; only "Stop tracking only" is available with a manual-cleanup note
- [ ] AC-9: the deletion PR file diff contains only `.devdigest/agents/<slug>.yaml`, `.devdigest/skills/<slug>.md` files (one per currently linked skill), `.devdigest/memory.jsonl`, `.devdigest/runner/index.js`, and `.github/workflows/devdigest-review.yml` — no other files appear in the diff
