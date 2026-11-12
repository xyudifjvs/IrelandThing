import type { ReactNode } from "react";
import Shell from "./_components/Shell";
import { NotesHistoryBoundary } from "./_features/private-notes/NotesHistoryBoundary";
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <NotesHistoryBoundary>
      <Shell>{children}</Shell>
    </NotesHistoryBoundary>
  );
}
