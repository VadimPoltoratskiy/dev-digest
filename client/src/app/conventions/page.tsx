import { Suspense } from "react";
import { ConventionsView } from "./_components/ConventionsView";

/* Route: /conventions — Conventions Extractor. Suspense needed for useSearchParams. */
export default function ConventionsPage() {
  return (
    <Suspense>
      <ConventionsView />
    </Suspense>
  );
}
