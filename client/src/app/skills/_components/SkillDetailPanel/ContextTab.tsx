"use client";

import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { useSetSkillContext } from "../../../../lib/hooks/skills";
import { ContextDocsEditor } from "../../../../components/ContextDocsEditor";

/** Skill editor → Context tab. Attach/reorder Project Context documents. */
export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const setContext = useSetSkillContext();

  return (
    <ContextDocsEditor
      title={t("context.title")}
      hint={t("context.hint")}
      attachedPaths={skill.context_docs}
      onSetPaths={(paths) => setContext.mutate({ skillId: skill.id, paths })}
    />
  );
}
