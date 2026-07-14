/* MultiRunHistoryView — paginated list of past multi-agent review runs for a repo.
   Repo is read from context (useActiveRepo), with a switcher shown when >1 repo exists.
   Pagination uses offset accumulation state — not useInfiniteQuery — to keep the hook
   API consistent with other multi-runs hooks. All strings via next-intl "multiRuns.history". */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRepos } from "@/lib/hooks";
import { useActiveRepo } from "@/lib/repo-context";
import { useMultiRuns } from "@/lib/hooks/multi-runs";
import { AppShell } from "@/components/app-shell";
import { s } from "./styles";
import type { MultiRunSummary } from "@devdigest/shared";

const LIMIT = 20;

export function MultiRunHistoryView() {
  const t = useTranslations("multiRuns");
  const router = useRouter();

  // ---- Repo selection (same pattern as ConfigureRunView lines 208-219) ------
  const { repoId: activeRepoId } = useActiveRepo();
  const { data: repoList } = useRepos();
  const [selectedRepoId, setSelectedRepoId] = React.useState<string | null>(null);

  // Initialize selectedRepoId once the active repo loads (avoid resetting on every render).
  const didInitRepo = React.useRef(false);
  React.useEffect(() => {
    if (!didInitRepo.current && activeRepoId) {
      setSelectedRepoId(activeRepoId);
      didInitRepo.current = true;
    }
  }, [activeRepoId]);

  // ---- Pagination state -----------------------------------------------------
  const [currentOffset, setCurrentOffset] = React.useState(0);
  const [allItems, setAllItems] = React.useState<MultiRunSummary[]>([]);

  // ---- Query ----------------------------------------------------------------
  const { data, isLoading, isError } = useMultiRuns(selectedRepoId, {
    limit: LIMIT,
    offset: currentOffset,
  });

  // ---- Accumulate items -----------------------------------------------------
  // When currentOffset === 0: replace (initial load or repo-change reset).
  // Otherwise: append (Load more).
  React.useEffect(() => {
    if (!data) return;
    if (currentOffset === 0) {
      setAllItems(data.items);
    } else {
      setAllItems((prev) => [...prev, ...data.items]);
    }
  }, [data, currentOffset]);

  // ---- Handlers -------------------------------------------------------------

  const handleRepoChange = (repoId: string) => {
    setSelectedRepoId(repoId);
    setCurrentOffset(0);
    setAllItems([]);
  };

  const repos = repoList ?? [];
  const crumb = [{ label: t("history.title"), href: "/multi-runs" }];

  // ---- Loading first page ---------------------------------------------------
  if (isLoading && allItems.length === 0) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.headingRow}>
            <h1 style={s.heading}>{t("history.title")}</h1>
          </div>
          <div style={s.loadingWrap}>{t("configure.loading")}</div>
        </div>
      </AppShell>
    );
  }

  // ---- Error state ----------------------------------------------------------
  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.headingRow}>
            <h1 style={s.heading}>{t("history.title")}</h1>
          </div>
          <div style={s.errorWrap}>
            <div style={s.errorTitle}>{t("history.errorTitle")}</div>
            <div style={s.errorBody}>{t("history.errorBody")}</div>
          </div>
        </div>
      </AppShell>
    );
  }

  // ---- Normal render --------------------------------------------------------
  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {/* Page header: title on left, Configure run button on right */}
        <div style={s.headingRow}>
          <h1 style={s.heading}>{t("history.title")}</h1>
          <button
            type="button"
            style={s.configureBtn}
            onClick={() =>
              router.push(
                `/multi-runs/configure?repoId=${selectedRepoId ?? ""}`,
              )
            }
          >
            {t("history.configureRun")}
          </button>
        </div>

        {/* Repo picker — only shown when multiple repos exist */}
        {repos.length > 1 && (
          <select
            aria-label="Select repository"
            style={s.selectSmall}
            value={selectedRepoId ?? ""}
            onChange={(e) => handleRepoChange(e.target.value)}
          >
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
          </select>
        )}

        {/* Empty state */}
        {allItems.length === 0 ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyTitle}>{t("history.emptyTitle")}</div>
            <div style={s.emptyBody}>{t("history.emptyBody")}</div>
            <button
              type="button"
              style={s.emptyBtn}
              onClick={() =>
                router.push(
                  `/multi-runs/configure?repoId=${selectedRepoId ?? ""}`,
                )
              }
            >
              {t("history.configureRun")}
            </button>
          </div>
        ) : (
          <>
            {/* Table */}
            <div style={s.tableCard}>
              {/* Header row */}
              <div style={s.headRow}>
                <div style={s.headCell}>{t("history.columns.pr")}</div>
                <div style={s.headCell}>{t("history.columns.agents")}</div>
                <div style={s.headCell}>{t("history.columns.status")}</div>
                <div style={s.headCell}>{t("history.columns.cost")}</div>
                <div style={s.headCell}>{t("history.columns.duration")}</div>
                <div style={s.headCell}>{t("history.columns.ranAt")}</div>
              </div>

              {/* Data rows */}
              {allItems.map((item) => (
                <div
                  key={item.id}
                  style={s.dataRow}
                  onClick={() => router.push(`/multi-runs/${item.id}`)}
                  data-testid="run-row"
                >
                  <div style={s.dataCell}>
                    {item.pr_number != null
                      ? t("results.prTitle", {
                          number: item.pr_number,
                          title: item.pr_title ?? "",
                        })
                      : item.pr_id}
                  </div>
                  <div style={s.dataCell}>{item.agent_count}</div>
                  <div style={s.dataCell}>
                    {t(`history.status.${item.status}`)}
                  </div>
                  <div style={s.dataCell}>
                    {item.total_cost_usd != null
                      ? t("history.costValue", {
                          value: item.total_cost_usd.toFixed(4),
                        })
                      : t("history.emptyValue")}
                  </div>
                  <div style={s.dataCell}>
                    {item.total_duration_ms != null
                      ? t("history.durationValue", {
                          seconds: Math.round(item.total_duration_ms / 1000),
                        })
                      : t("history.emptyValue")}
                  </div>
                  <div style={s.dataCell}>
                    {new Date(item.ran_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            {/* Load more */}
            {allItems.length < (data?.total ?? 0) && !isLoading && (
              <button
                type="button"
                style={s.loadMoreBtn}
                onClick={() => setCurrentOffset((prev) => prev + LIMIT)}
              >
                {t("history.loadMore")}
              </button>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
