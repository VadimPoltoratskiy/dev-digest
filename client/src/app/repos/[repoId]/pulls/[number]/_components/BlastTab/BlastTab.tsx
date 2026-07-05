"use client";

import React from "react";
import { Icon, Badge, MonoLink, SectionLabel, EmptyState, Skeleton } from "@devdigest/ui";
import { useBlastRadius, useBlastExplanation, useExplainBlast } from "@/lib/hooks";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

interface BlastTabProps {
  prId: string | null;
  /** owner/repo — needed to deep-link a caller to its GitHub blob line. */
  repoFullName: string | null;
  /** PR head SHA — pins caller deep-links so line numbers stay accurate. */
  headSha: string;
}

export function BlastTab({ prId, repoFullName, headSha }: BlastTabProps) {
  const { data, isLoading, isError } = useBlastRadius(prId);
  const explanation = useBlastExplanation(prId);
  const explain = useExplainBlast(prId);

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Zap">Blast radius</SectionLabel>
        <Skeleton height={180} />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section>
        <SectionLabel icon="Zap">Blast radius</SectionLabel>
        <EmptyState
          icon="Zap"
          title="Blast radius unavailable"
          body="The impact map couldn't be loaded. Try running a review or refreshing the repo index."
        />
      </section>
    );
  }

  const { changed_symbols, downstream, summary, degraded, reason } = data;

  const callerCount = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(downstream.flatMap((d) => d.crons_affected)).size;

  const canLink = !!repoFullName && !!headSha;

  const ex = explanation.data;
  const explainButton = (
    <button
      style={s.explainBtn}
      onClick={() => explain.mutate()}
      disabled={explain.isPending}
      title="One cheap model call — explains this map in a paragraph"
    >
      <Icon.Zap size={13} />
      {explain.isPending ? "Explaining…" : ex ? "Regenerate" : "Explain with AI"}
    </button>
  );

  return (
    <section>
      <SectionLabel icon="Zap" right={explainButton}>
        Blast radius
      </SectionLabel>
      <div style={s.wrap}>
        <div style={s.summaryRow}>
          <Badge icon="Boxes" color="var(--accent-text)" bg="var(--accent-bg)">
            {changed_symbols.length} {changed_symbols.length === 1 ? "symbol" : "symbols"}
          </Badge>
          <Badge icon="CornerDownRight">
            {callerCount} {callerCount === 1 ? "caller" : "callers"}
          </Badge>
          <Badge icon="Globe">
            {endpointCount} {endpointCount === 1 ? "endpoint" : "endpoints"}
          </Badge>
          {cronCount > 0 && (
            <Badge icon="Clock">
              {cronCount} {cronCount === 1 ? "cron" : "crons"}
            </Badge>
          )}
        </div>

        <p style={s.summaryText}>{summary}</p>

        {ex && (
          <div style={s.explainCard}>
            <p style={s.explainText}>{ex.explanation}</p>
            <div style={s.explainFooter}>
              <Icon.Zap size={11} />
              <span className="mono">{ex.model}</span>
              {ex.cost_usd != null && <span>· ${ex.cost_usd.toFixed(4)}</span>}
            </div>
          </div>
        )}

        {degraded && (
          <div style={s.degradedBanner}>
            <Icon.AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>
              Partial index — this map is best-effort and may be incomplete
              {reason ? ` (${reason})` : ""}.
            </span>
          </div>
        )}

        {downstream.length === 0 ? (
          <EmptyState
            icon="Boxes"
            title="No downstream callers"
            body={
              changed_symbols.length === 0
                ? "The repo index found no symbols in the changed files."
                : "These changes declare symbols, but nothing in the index calls them yet."
            }
          />
        ) : (
          downstream.map((group) => (
            <div key={group.symbol} style={s.group}>
              <div style={s.groupHeader}>
                <Icon.Boxes size={15} style={{ color: "var(--accent-text)" }} />
                <span style={s.symbolName} className="mono">
                  {group.symbol}
                </span>
                <Badge>
                  {group.callers.length} {group.callers.length === 1 ? "caller" : "callers"}
                </Badge>
              </div>

              <div>
                <div style={{ ...s.levelLabel, marginBottom: 6 }}>Callers</div>
                <div style={s.callerList}>
                  {group.callers.map((c, i) => (
                    <div key={`${c.file}:${c.line}:${i}`} style={s.callerRow}>
                      <Icon.CornerDownRight size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                      <span style={s.callerName} className="mono">
                        {c.name}
                      </span>
                      <span style={s.callerSep}>—</span>
                      <MonoLink href={canLink ? githubBlobUrl(repoFullName!, headSha, c.file, c.line) : undefined}>
                        {c.file}:{c.line}
                      </MonoLink>
                    </div>
                  ))}
                </div>
              </div>

              {(group.endpoints_affected.length > 0 || group.crons_affected.length > 0) && (
                <div>
                  <div style={{ ...s.levelLabel, marginBottom: 6 }}>Affected endpoints</div>
                  <div style={s.badgeRow}>
                    {group.endpoints_affected.map((e) => (
                      <Badge key={e} icon="Globe" mono color="var(--accent-text)" bg="var(--accent-bg)">
                        {e}
                      </Badge>
                    ))}
                    {group.crons_affected.map((cr) => (
                      <Badge key={cr} icon="Clock" mono color="var(--warn)" bg="var(--warn-bg)">
                        {cr}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
