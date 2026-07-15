import type { FindingRecord, FindingGroup } from '@devdigest/shared';

/**
 * Pure function: group findings across agents by file + overlapping line range.
 *
 * AC-12: two ranges [A.start, A.end] and [B.start, B.end] overlap iff
 *   A.start <= B.end AND B.start <= A.end.
 *
 * Algorithm:
 *   1. Group agentFindings by file (exact path match).
 *   2. Within each file, sort findings by start_line, then run a greedy
 *      clustering pass: each finding either merges into the current open
 *      cluster (if it overlaps the cluster's accumulated range) or starts
 *      a new cluster.  After each merge, expand [start, end] to the union.
 *   3. For each cluster: start_line = min, end_line = max of all merged ranges.
 *   4. For each cluster, iterate allAgents: include the agent's FindingRecord
 *      if it contributed a finding to this cluster, else null ("did not flag").
 *
 * No LLM call, no DB access, no substance or category filter.
 */
export function groupFindingsByFileAndOverlap(
  agentFindings: { agentId: string | null; agentName: string | null; finding: FindingRecord }[],
  allAgents: { agentId: string | null; agentName: string | null }[],
): FindingGroup[] {
  // Step 1: group by file
  const byFile = new Map<
    string,
    { agentId: string | null; agentName: string | null; finding: FindingRecord }[]
  >();
  for (const entry of agentFindings) {
    const key = entry.finding.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(entry);
  }

  const result: FindingGroup[] = [];

  for (const [file, entries] of byFile) {
    // Step 2: sort by start_line for stable greedy pass
    const sorted = [...entries].sort(
      (a, b) => a.finding.start_line - b.finding.start_line,
    );

    // Greedy clustering
    type Cluster = {
      startLine: number;
      endLine: number;
      entries: { agentId: string | null; agentName: string | null; finding: FindingRecord }[];
    };

    const clusters: Cluster[] = [];
    let current: Cluster | null = null;

    for (const entry of sorted) {
      const { start_line, end_line } = entry.finding;
      if (current === null) {
        current = { startLine: start_line, endLine: end_line, entries: [entry] };
      } else if (
        start_line <= current.endLine &&
        current.startLine <= end_line
      ) {
        // Overlaps — merge into current cluster
        current.entries.push(entry);
        if (start_line < current.startLine) current.startLine = start_line;
        if (end_line > current.endLine) current.endLine = end_line;
      } else {
        // No overlap — finalize current cluster, start a new one
        clusters.push(current);
        current = { startLine: start_line, endLine: end_line, entries: [entry] };
      }
    }
    if (current !== null) clusters.push(current);

    // Step 3–4: build FindingGroup for each cluster
    for (const cluster of clusters) {
      const agentVerdicts = allAgents.map(({ agentId, agentName }) => {
        // Find this agent's finding in the cluster (first match)
        const match = cluster.entries.find((e) => e.agentId === agentId);
        return {
          agent_id: agentId,
          agent_name: agentName,
          finding: match ? match.finding : null,
        };
      });

      result.push({
        file,
        start_line: cluster.startLine,
        end_line: cluster.endLine,
        agent_verdicts: agentVerdicts,
      });
    }
  }

  return result;
}
