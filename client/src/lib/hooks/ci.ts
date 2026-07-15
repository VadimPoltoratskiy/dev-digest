/* hooks/ci.ts — React Query hooks for CI Runs, CI Installations, Export Wizard, and Preflight. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CiExportInputBody } from "@devdigest/shared";
import {
  fetchCiRuns,
  fetchCiInstallations,
  removeCiInstallation,
  removeCiFromRepo,
  refreshCiRuns,
  exportCi,
  checkCiPreflight,
} from "../api";

/** Fetch all CI runs, optionally filtered by agent. */
export function useCiRuns(agentId?: string) {
  return useQuery({
    queryKey: ["ci-runs", agentId ?? null],
    queryFn: () => fetchCiRuns(agentId),
  });
}

/** Fetch CI installations for a specific agent. */
export function useCiInstallations(agentId: string) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => fetchCiInstallations(agentId),
  });
}

/** Mutation: stop tracking a CI installation ("Remove from CI"). */
export function useRemoveCiInstallation(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installationId: string) => removeCiInstallation(agentId, installationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

/** Mutation: trigger a workspace-level CI run refresh from GitHub Actions. */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshCiRuns,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ci-runs"] }),
  });
}

/** Mutation: export CI files for an agent (open PR or return file bundle). */
export function useExportCi(agentId: string) {
  return useMutation({
    mutationFn: (input: CiExportInputBody) => exportCi(agentId, input),
  });
}

/** Query: preflight check for write access to a target repository. */
export function useCiPreflight(repo: string | null) {
  return useQuery({
    queryKey: ["ci-preflight", repo],
    queryFn: () => checkCiPreflight(repo!),
    enabled: !!repo,
  });
}

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
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}
