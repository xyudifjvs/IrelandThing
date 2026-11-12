import { Heading } from "../_components/WorkspaceHeading";
import { PrivateTodoPanel } from "../_features/private-notes/PrivateTodoPanel";
import { PrivateScratchpad } from "../_features/private-notes/PrivateScratchpad";
import s from "../_components/workspace.module.css";

export const dynamic = "force-dynamic";

export default function NotesPage() {
  return (
    <>
      <Heading
        eyebrow="Private workspace"
        title="Notes"
        subtitle="Keep your scratchpad and to-dos in one place."
      />
      <div className={s.twoCol}>
        <PrivateScratchpad />
        <PrivateTodoPanel />
      </div>
    </>
  );
}
