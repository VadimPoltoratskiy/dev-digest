import type { IndexStatus } from '../repo-intel/types.js';

export interface FactsBundle {
  runtimeName: string | null;           // from engines.node
  frameworkNames: string[];             // detected from topLevelDeps keys
  runScripts: Record<string, string>;   // package.json scripts; empty if no package.json
  engines: Record<string, string>;      // package.json engines; empty if absent
  topLevelDeps: Record<string, string>; // dependencies + devDependencies merged
  directoryTree: string;               // compact indented tree string (2 levels, for prompt)
  allDiscoveredFiles: string[];         // COMPLETE flat file list from 2-level FS scan
  topRankedFiles: string[];            // from repo-intel getTopFilesByRank(repoId, 20)
  criticalPaths: string[][];           // from repo-intel getCriticalPaths(repoId)
  routeList: string[];                 // always [] in v1
  indexStatus: IndexStatus;            // 'full'|'partial'|'degraded'|'failed' — set by service
}

export const ONBOARDING_SECTIONS = [
  { kind: 'architecture_overview', title: 'Architecture Overview' },
  { kind: 'critical_paths',        title: 'Critical Paths'        },
  { kind: 'how_to_run',            title: 'How to Run Locally'    },
  { kind: 'reading_order',         title: 'Guided Reading Order'  },
  { kind: 'first_tasks',           title: 'First Tasks'           },
] as const;
export type OnboardingSectionKind = (typeof ONBOARDING_SECTIONS)[number]['kind'];
