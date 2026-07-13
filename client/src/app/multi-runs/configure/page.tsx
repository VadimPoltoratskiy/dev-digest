/* Configure Run page — /multi-runs/configure[?prId=<uuid>]
   Thin page: awaits async searchParams (Next.js 15 async API), renders ConfigureRunView. */

import { ConfigureRunView } from "./_components/ConfigureRunView";

export default async function ConfigureRunPage({
  searchParams,
}: {
  searchParams: Promise<{ prId?: string }>;
}) {
  const { prId } = await searchParams;
  return <ConfigureRunView initialPrId={prId} />;
}
