import { Suspense } from "react";
import { MemoryView } from "./_components/MemoryView";

/* Route: /memory — Structured memory records. Suspense needed for useSearchParams. */
export default function MemoryPage() {
  return (
    <Suspense>
      <MemoryView />
    </Suspense>
  );
}
