/* Multi-Agent Review results page — /multi-runs/:multiRunId.
   Thin page: awaits async params (Next.js 15), renders MultiRunResultsView. */

import { MultiRunResultsView } from "./_components/MultiRunResultsView";

export default async function MultiRunResultsPage({
  params,
}: {
  params: Promise<{ multiRunId: string }>;
}) {
  const { multiRunId } = await params;
  return <MultiRunResultsView multiRunId={multiRunId} />;
}
