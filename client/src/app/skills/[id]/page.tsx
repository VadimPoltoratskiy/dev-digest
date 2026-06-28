import { SkillEditor } from "./_components/SkillEditor";

/* Route: /skills/:id (Skill detail + editor). Thin route — logic in _components. */
export default function SkillPage({ params }: { params: { id: string } }) {
  return <SkillEditor id={params.id} />;
}
