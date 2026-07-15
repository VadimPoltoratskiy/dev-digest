/* AgentEditor — basic agent config editor (model + system prompt). Later
   lessons add Skills/Evals/Stats/CI tabs; the Part-0 starter ships Config only.
   Tab state still lives in ?tab= for forward-compatibility. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { ContextTab } from "./_components/ContextTab";
import { EvalsTab } from "./_components/EvalsTab";
import { CiTab } from "./_components/CiTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  // Portal target for the CI tab's header-level actions ("Add to CI" /
  // "Update CI config") — rendered here, in the shared tabs bar row, but
  // owned/populated by CiTab so the wizard-open state stays colocated with
  // the rest of the CI tab's logic instead of being lifted onto every tab.
  const [ciActionsEl, setCiActionsEl] = React.useState<HTMLDivElement | null>(null);

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
        <div ref={setCiActionsEl} style={s.tabsBarActions} />
      </div>
      <div style={s.body}>
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "skills" && <SkillsTab agentId={agent.id} />}
        {tab === "context" && <ContextTab agent={agent} />}
        {tab === "evals" && <EvalsTab agentId={agent.id} />}
        {tab === "ci" && (
          <CiTab agentId={agent.id} ciFailOn={agent.ci_fail_on} headerActionsEl={ciActionsEl} />
        )}
      </div>
    </div>
  );
}
