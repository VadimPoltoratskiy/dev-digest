"use client";

import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { useSetAgentContext } from "../../../../../../../lib/hooks/agents";
import { ContextDocsEditor } from "../../../../../../../components/ContextDocsEditor";

/** Agent editor → Context tab. Attach/reorder Project Context documents. */
export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const setContext = useSetAgentContext();

  return (
    <ContextDocsEditor
      title={t("context.title")}
      hint={t("context.hint")}
      attachedPaths={agent.context_docs}
      onSetPaths={(paths) => setContext.mutate({ agentId: agent.id, paths })}
    />
  );
}
