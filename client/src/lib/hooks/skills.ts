/* hooks/skills.ts — React Query hooks for the A1 Skills Lab + Agent Editor Skills tab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Skill,
  AgentSkillLink,
  SkillType,
  SkillSource,
  SkillVersionEntry,
  SkillEvalCase,
  SkillEvalRunResult,
  SkillStats,
  CommunitySkillEntry,
} from "@devdigest/shared";

// ---- Skills CRUD ----

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useToggleSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<Skill>(`/skills/${id}`, { enabled }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

// ---- Import flow (preview then save) ----

export interface ImportPreviewResult {
  name: string;
  body_preview: string;
  token_count: number;
}

export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (input: { body: string; name?: string }) =>
      api.post<ImportPreviewResult>("/skills/import", input),
  });
}

export interface ImportSkillSaveInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source: "imported_url" | "community";
}

export function useImportSkillSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportSkillSaveInput) =>
      api.post<Skill>("/skills/import/save", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

// ---- Agent ↔ Skill links ----

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}

export function useLinkSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId, order }: { agentId: string; skillId: string; order?: number }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_id: skillId, order }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}

export function useUnlinkSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.del<AgentSkillLink[]>(`/agents/${agentId}/skills/${skillId}`),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}

// ---- Version history ----

export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", skillId],
    queryFn: () => api.get<SkillVersionEntry[]>(`/skills/${skillId}/versions`),
    enabled: !!skillId,
  });
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, version }: { skillId: string; version: number }) =>
      api.post<Skill>(`/skills/${skillId}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

// ---- Stats ----

export function useSkillStats(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", skillId],
    queryFn: () => api.get<SkillStats>(`/skills/${skillId}/stats`),
    enabled: !!skillId,
  });
}

// ---- Eval cases ----

export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-cases", skillId],
    queryFn: () => api.get<SkillEvalCase[]>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
  });
}

export interface CreateEvalCaseInput {
  name: string;
  notes?: string;
  input_diff: string;
  expected_finding_count?: number;
  category?: string;
  severity?: string;
}

export function useCreateEvalCase(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEvalCaseInput) =>
      api.post<SkillEvalCase>(`/skills/${skillId}/eval-cases`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] });
    },
  });
}

export function useUpdateEvalCase(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, patch }: { caseId: string; patch: Partial<CreateEvalCaseInput> }) =>
      api.put<SkillEvalCase>(`/skills/${skillId}/eval-cases/${caseId}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] });
    },
  });
}

export function useDeleteEvalCase(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<void>(`/skills/${skillId}/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] });
    },
  });
}

export function useRunEvalCase(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<SkillEvalRunResult>(`/skills/${skillId}/eval-cases/${caseId}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] });
    },
  });
}

export function useRunAllEvalCases(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ total: number; passed: number }>(`/skills/${skillId}/eval-cases/run-all`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] });
    },
  });
}

// ---- Community catalog ----

export function useSearchCommunitySkills(
  q?: string,
  opts?: { lang?: string; tag?: string },
) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (opts?.lang) params.set("lang", opts.lang);
  if (opts?.tag) params.set("tag", opts.tag);
  const qs = params.toString();

  return useQuery({
    queryKey: ["community-skills", q, opts?.lang, opts?.tag],
    queryFn: () => api.get<CommunitySkillEntry[]>(`/skills/community${qs ? `?${qs}` : ""}`),
  });
}
