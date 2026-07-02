import { Suspense } from "react";
import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (Skills Lab list). Suspense needed for useSearchParams in SkillsListView. */
export default function SkillsPage() {
  return (
    <Suspense>
      <SkillsListView />
    </Suspense>
  );
}
