import { Suspense } from "react";
import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /context — Project Context (specs/docs/insights discovery + attach). */
export default function ContextPage() {
  return (
    <Suspense>
      <ProjectContextView />
    </Suspense>
  );
}
