import type { SkillCase } from "../../src/index.js";

// This skill's job is to inspect `git diff $(git merge-base main HEAD)..HEAD` (Step 1), but
// "quality" cases run with no tools (skillTask measures the SKILL.md content in isolation — no
// on-disk config, no Bash). So each prompt inlines the diff the skill would normally gather
// itself, standing in for what `git diff` would have produced — same technique
// evals/skills/dependency-checker uses for its REPO_DATA constant. Diffs are adapted from the
// three worked sessions in .claude/skills/pr-self-review/examples.md.

const DIFF_PREAMBLE = (branch: string, diff: string) =>
  `Run a self-review on the current branch "${branch}". Here is the full diff you would normally get from \`git diff $(git merge-base main HEAD)..HEAD\` — treat it as already collected, and produce the review directly from it (do not ask for tool access or to run git yourself).\n\n${diff}`;

export const cases: SkillCase[] = [
  {
    name: "clean frontend-only PR with correct colocation → PASS, zero CRITICAL",
    kind: "quality",
    prompt: DIFF_PREAMBLE(
      "feature/agent-card-component",
      `diff --git a/client/src/app/agents/_components/AgentCard/AgentCard.tsx b/client/src/app/agents/_components/AgentCard/AgentCard.tsx
new file mode 100644
--- /dev/null
+++ b/client/src/app/agents/_components/AgentCard/AgentCard.tsx
@@ -0,0 +1,12 @@
+export function AgentCard({ name }: { name: string }) {
+  return <div>{name}</div>;
+}
diff --git a/client/src/app/agents/_components/AgentCard/index.ts b/client/src/app/agents/_components/AgentCard/index.ts
new file mode 100644
--- /dev/null
+++ b/client/src/app/agents/_components/AgentCard/index.ts
@@ -0,0 +1,1 @@
+export { AgentCard } from "./AgentCard";
diff --git a/client/src/app/agents/_components/AgentCard/AgentCard.test.tsx b/client/src/app/agents/_components/AgentCard/AgentCard.test.tsx
new file mode 100644
--- /dev/null
+++ b/client/src/app/agents/_components/AgentCard/AgentCard.test.tsx
@@ -0,0 +1,6 @@
+import { render, screen } from "@testing-library/react";
+import { AgentCard } from "./AgentCard";
+test("renders name", () => {
+  render(<AgentCard name="reviewer" />);
+  expect(screen.getByText("reviewer")).toBeInTheDocument();
+});
diff --git a/client/src/lib/hooks/agents.ts b/client/src/lib/hooks/agents.ts
--- a/client/src/lib/hooks/agents.ts
+++ b/client/src/lib/hooks/agents.ts
@@ -10,6 +10,10 @@
 export function useAgents() {
   return useQuery({ queryKey: ["agents"], queryFn: () => api.get("/agents") });
 }
+
+export function useAgent(id: string) {
+  return useQuery({ queryKey: ["agent", id], queryFn: () => api.get(\`/agents/\${id}\`) });
+}`,
    ),
    practices: [
      "the review names ui-architecture as an applied companion skill (frontend surface detected)",
      "the review has zero CRITICAL findings",
      "the final verdict is PASS, not BLOCKED",
      "the AgentCard files are noted as correctly colocated under _components/ with an index.ts barrel and a colocated test file, not flagged as violations",
    ],
    grounding: ["PASS"],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "DB query in route handler + hand-edited migration → BLOCKED with 2 CRITICAL, cited by file:line",
    kind: "quality",
    prompt: DIFF_PREAMBLE(
      "feature/add-comment-endpoint",
      `diff --git a/server/src/modules/reviews/routes.ts b/server/src/modules/reviews/routes.ts
--- a/server/src/modules/reviews/routes.ts
+++ b/server/src/modules/reviews/routes.ts
@@ -38,6 +38,17 @@
+app.post('/pulls/:id/comments', { schema: { params: IdParams } }, async (req) => {
+  const { workspaceId } = await getContext(container, req);
+  const body = CreateCommentBody.parse(req.body);
+  // direct DB query in route handler:
+  const [comment] = await db
+    .insert(comments)
+    .values({ pullId: req.params.id, text: body.text, workspaceId })
+    .returning();
+  return { id: comment.id, text: comment.text };
+});
diff --git a/server/src/db/migrations/0015_comments.sql b/server/src/db/migrations/0015_comments.sql
new file mode 100644
--- /dev/null
+++ b/server/src/db/migrations/0015_comments.sql
@@ -0,0 +1,3 @@
+-- Hand-edited to add index manually
+CREATE TABLE comments (id uuid primary key, pull_id uuid, text text, workspace_id uuid);
+CREATE INDEX idx_comments_pull ON comments(pull_id);  -- added by hand`,
    ),
    practices: [
      "a CRITICAL finding cites server/src/modules/reviews/routes.ts with a line number, for the route handler calling db.insert() directly instead of going through a repository",
      "a CRITICAL finding cites server/src/db/migrations/0015_comments.sql for the migration SQL being hand-edited instead of generated via `pnpm db:generate`",
      "the review names onion-architecture and drizzle-orm-patterns as applied companion skills (backend surface detected)",
      "the final verdict is BLOCKED, not PASS",
    ],
    grounding: ["BLOCKED"],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "mixed frontend+backend PR routes to both companion skill sets and flags the HIGH-only vendor/shared drift",
    kind: "quality",
    prompt: DIFF_PREAMBLE(
      "feature/sync-agent-contract",
      `diff --git a/server/src/vendor/shared/contracts/agents.ts b/server/src/vendor/shared/contracts/agents.ts
--- a/server/src/vendor/shared/contracts/agents.ts
+++ b/server/src/vendor/shared/contracts/agents.ts
@@ -4,6 +4,7 @@
 export const AgentDto = z.object({
   id: z.string(),
   name: z.string(),
+  agentVersion: z.number().int(),
 });
diff --git a/server/src/modules/agents/routes.ts b/server/src/modules/agents/routes.ts
--- a/server/src/modules/agents/routes.ts
+++ b/server/src/modules/agents/routes.ts
@@ -20,6 +20,7 @@
   return {
     id: agent.id,
     name: agent.name,
+    agentVersion: agent.version,
   };
diff --git a/client/src/lib/api.ts b/client/src/lib/api.ts
--- a/client/src/lib/api.ts
+++ b/client/src/lib/api.ts
@@ -1,4 +1,4 @@
-// client vendor/shared NOT updated — still uses old AgentDto type
+// client vendor/shared NOT updated — still uses old AgentDto type
 import type { AgentDto } from '../vendor/shared';  // missing agentVersion field
diff --git a/client/src/lib/hooks/agents.ts b/client/src/lib/hooks/agents.ts
--- a/client/src/lib/hooks/agents.ts
+++ b/client/src/lib/hooks/agents.ts
@@ -12,4 +12,5 @@
 export function useAgent(id: string) {
   return useQuery({ queryKey: ["agent", id], queryFn: () => api.get(\`/agents/\${id}\`) });
 }
+// TODO: surface agentVersion once client vendor/shared is synced`,
    ),
    practices: [
      "the review names companion skills from BOTH the frontend row (ui-architecture and/or react-best-practices) and the backend row (onion-architecture and/or fastify-best-practices), since both server/src and client/src paths changed",
      "a finding (HIGH or CRITICAL) calls out that client/src/vendor/shared/ was not updated to match the server/src/vendor/shared/ contract change (agentVersion field), i.e. the two vendor/shared directories are out of sync",
      "this finding does not appear under a CRITICAL section that also claims the verdict must be BLOCKED for this specific vendor-sync issue alone — a vendor/shared drift like this is HIGH, not a hard blocker, per the skill's severity table",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "direct edit to a vendor/ file is flagged CRITICAL even with no other violations",
    kind: "quality",
    prompt: DIFF_PREAMBLE(
      "feature/tweak-button-primitive",
      `diff --git a/client/src/vendor/ui/primitives/Button.tsx b/client/src/vendor/ui/primitives/Button.tsx
--- a/client/src/vendor/ui/primitives/Button.tsx
+++ b/client/src/vendor/ui/primitives/Button.tsx
@@ -12,7 +12,7 @@
 export function Button({ kind, children }: ButtonProps) {
   return (
-    <button className={kind}>{children}</button>
+    <button className={kind} style={{ borderRadius: 999 }}>{children}</button>
   );
 }`,
    ),
    practices: [
      "a CRITICAL finding cites client/src/vendor/ui/primitives/Button.tsx as a directly modified vendor/ file, which is explicitly listed as a CRITICAL anti-pattern",
      "the final verdict is BLOCKED, not PASS",
    ],
    grounding: ["BLOCKED"],
    threshold: 0.7,
    maxTurns: 10,
  },
];
