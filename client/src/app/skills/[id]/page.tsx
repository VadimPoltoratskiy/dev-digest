import { redirect } from "next/navigation";

/* /skills/:id — editing moved into the list page's Config tab. Redirect there. */
export default function SkillPage({ params }: { params: { id: string } }) {
  redirect(`/skills?selected=${params.id}`);
}
