# UI Architecture — Examples

Good and bad placement decisions for common scenarios, grounded in the actual project structure.

---

## Adding a Component Used Only on the PR Detail Page

**Scenario:** You need a `ReviewSummary` component to display review metadata on the PR detail page.

```
# GOOD — colocated with its route
app/repos/[repoId]/pulls/[number]/
├── page.tsx
└── _components/
    └── ReviewSummary/
        ├── ReviewSummary.tsx
        ├── index.ts
        ├── helpers.ts          ← format duration, truncate text
        └── ReviewSummary.test.tsx

# BAD — premature promotion to shared components
components/
└── ReviewSummary/              ← used by only one route; does not belong here
    ├── ReviewSummary.tsx
    └── index.ts

# BAD — bare file at route level
app/repos/[repoId]/pulls/[number]/
├── page.tsx
└── ReviewSummary.tsx           ← no colocation folder, no index.ts, invisible to reviewers
```

---

## Adding a Component Used on Both PR List and PR Detail

**Scenario:** You need a `SeverityBadge` that appears in `PRRow` (list) and `FindingCard` (detail).

```
# GOOD — shared, because it's used by multiple routes
components/
└── SeverityBadge/
    ├── SeverityBadge.tsx
    ├── SeverityBadge.test.tsx
    └── index.ts

# BAD — duplicated inside each route
app/repos/[repoId]/pulls/_components/PRRow/SeverityBadge.tsx
app/repos/[repoId]/pulls/[number]/_components/FindingCard/SeverityBadge.tsx
```

---

## Nested Sub-Component Inside a Feature Component

**Scenario:** `RunTraceDrawer` is complex and needs its own `TraceHeader` sub-component.

```
# GOOD — nested _components/ inside the parent feature component
app/repos/[repoId]/pulls/[number]/_components/
└── RunTraceDrawer/
    ├── RunTraceDrawer.tsx
    ├── RunTraceDrawer.test.tsx
    ├── index.ts
    └── _components/
        └── TraceHeader/
            ├── TraceHeader.tsx
            └── index.ts

# BAD — TraceHeader promoted to components/ when used by one component
components/
└── TraceHeader/               ← used nowhere else; should stay colocated
```

---

## Adding a Data Hook

**Scenario:** You need to fetch review runs for the PR detail page.

```typescript
// GOOD — add to the matching domain file in lib/hooks/
// lib/hooks/reviews.ts
export function useReviewRuns(pullId: number) {
  return useQuery({
    queryKey: ['review-runs', pullId],
    queryFn: () => api.getReviewRuns(pullId),
  });
}

// BAD — hook defined inside the component file
// app/.../FindingCard/FindingCard.tsx
function FindingCard({ pullId }: Props) {
  const { data } = useQuery({            // ← inline query, not reusable
    queryKey: ['review-runs', pullId],
    queryFn: () => fetch(`/api/runs/${pullId}`).then(r => r.json()),  // ← direct fetch
  });
}
```

---

## Adding an API Call

**Scenario:** You need to call `POST /pulls/:id/review` to trigger a review.

```typescript
// GOOD — add an exported function to lib/api.ts
// lib/api.ts
export async function triggerReview(pullId: number, agentId: string): Promise<Review> {
  const res = await fetch(`${API_BASE}/pulls/${pullId}/review`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Then consume it in lib/hooks/reviews.ts via useMutation
export function useTriggerReview() {
  return useMutation({ mutationFn: ({ pullId, agentId }) => api.triggerReview(pullId, agentId) });
}

// BAD — fetch called directly inside a component
function RunReviewButton({ pullId }) {
  const handleClick = async () => {
    await fetch(`/api/pulls/${pullId}/review`, { method: 'POST' }); // ← never inline fetch
  };
}
```

---

## Page Structure: Thin vs. Fat

```tsx
// GOOD — thin page, delegates to _components
// app/repos/[repoId]/pulls/[number]/page.tsx
import { PrDetailView } from './_components/PrDetailView';

export default function PrDetailPage({ params }) {
  return <PrDetailView repoId={params.repoId} number={params.number} />;
}

// BAD — fat page with inline logic
// app/repos/[repoId]/pulls/[number]/page.tsx
export default function PrDetailPage({ params }) {
  const { data } = useReviews(params.number);   // ← hooks in page
  return (
    <div>
      {data?.map(r => (                          // ← rendering logic in page
        <div key={r.id}>
          <h2>{r.agentName}</h2>
          <p>{r.summary}</p>
        </div>
      ))}
    </div>
  );
}
```

---

## Test File Placement

```
# GOOD — colocated with the component
app/repos/[repoId]/pulls/[number]/_components/FindingCard/
├── FindingCard.tsx
├── FindingCard.test.tsx    ← right here
└── index.ts

# BAD — separate __tests__ directory
app/repos/[repoId]/pulls/[number]/
└── __tests__/
    └── FindingCard.test.tsx   ← disconnected from the source file
```

---

## Using vs. Modifying Vendor

```typescript
// GOOD — import a primitive and compose in components/
// components/DismissButton/DismissButton.tsx
import { Button } from '@/vendor/ui';

export function DismissButton({ onClick }: Props) {
  return <Button variant="ghost" size="sm" onClick={onClick}>Dismiss</Button>;
}

// BAD — modifying the vendored file
// vendor/ui/Button.tsx  ← never edit this file
export function Button({ variant, ...props }) {
  // Adding project-specific logic here breaks vendor integrity
}
```
