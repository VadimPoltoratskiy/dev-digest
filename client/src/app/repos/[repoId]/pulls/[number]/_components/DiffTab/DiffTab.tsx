"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, SmartDiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/core";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { WhyDrawer } from "../WhyDrawer";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** owner/repo — needed by the git-why drawer to link out to the linked PR. */
  repoFullName?: string | null;
}

export function DiffTab({ prId, filesCount, files, canComment, repoFullName }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const { data: smartDiff } = useSmartDiff(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart Diff (risk-grouped) is the default view; "Original order" reverts
  // to GitHub's own file order via the plain DiffViewer.
  const [order, setOrder] = React.useState<"smart" | "original">("smart");
  // git-why drawer target, opened from a per-line hover trigger in CodeLine.
  const [whyTarget, setWhyTarget] = React.useState<{ path: string; line: number } | null>(null);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {smartDiff && (
              <div style={{ display: "flex", gap: 2 }}>
                <Button kind="ghost" size="sm" active={order === "smart"} onClick={() => setOrder("smart")}>
                  Smart order
                </Button>
                <Button kind="ghost" size="sm" active={order === "original"} onClick={() => setOrder("original")}>
                  Original order
                </Button>
              </div>
            )}
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {order === "smart" && smartDiff ? (
        <SmartDiffViewer
          files={files}
          smartDiff={smartDiff}
          commenting={commenting}
          onOpenWhy={(path, line) => setWhyTarget({ path, line })}
        />
      ) : (
        <DiffViewer
          files={files}
          commenting={commenting}
          onOpenWhy={(path, line) => setWhyTarget({ path, line })}
        />
      )}
      {whyTarget && prId && (
        <WhyDrawer
          prId={prId}
          repoFullName={repoFullName}
          file={whyTarget.path}
          line={whyTarget.line}
          onClose={() => setWhyTarget(null)}
        />
      )}
    </section>
  );
}
