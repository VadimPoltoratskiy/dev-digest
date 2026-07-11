/* /evals/:agentId — per-agent Eval Dashboard drill-down. Thin page shell;
   all logic lives in AgentEvalDashboard (mirrors /agents/[id]/page.tsx). */
"use client";

import { useParams } from "next/navigation";
import { AgentEvalDashboard } from "./_components/AgentEvalDashboard";

export default function AgentEvalDashboardPage() {
  const { agentId } = useParams<{ agentId: string }>();
  return <AgentEvalDashboard agentId={agentId} />;
}
