/* Multi-Agent Review history page — /multi-runs.
   Thin page: no params/searchParams needed. MultiRunHistoryView reads active repo from context. */

import { MultiRunHistoryView } from "./_components/MultiRunHistoryView";

export default function MultiRunsPage() {
  return <MultiRunHistoryView />;
}
