/* /agent-performance — Global agent performance dashboard.
   Thin RSC page; Suspense needed because AgentPerformanceDashboard uses useSearchParams. */

import { Suspense } from "react";
import { AgentPerformanceDashboard } from "./_components/AgentPerformanceDashboard";

export default function AgentPerformancePage() {
  return (
    <Suspense>
      <AgentPerformanceDashboard />
    </Suspense>
  );
}
