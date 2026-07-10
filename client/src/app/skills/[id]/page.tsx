"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/* /skills/:id — editing moved into the list page's Config tab. Redirect there. */
export default function SkillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/skills?selected=${id}`);
  }, [id, router]);

  return null;
}
