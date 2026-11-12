"use client";

import { useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { clearScratchpadDrafts } from "./scratchpad-draft";

export function NotesHistoryBoundary({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    function hideNotes() {
      // Remove private content before the browser can freeze this document.
      flushSync(() => setVisible(false));
      clearScratchpadDrafts();
    }
    function restoreSession(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener("pagehide", hideNotes);
    window.addEventListener("pageshow", restoreSession);
    return () => {
      window.removeEventListener("pagehide", hideNotes);
      window.removeEventListener("pageshow", restoreSession);
    };
  }, []);

  return visible ? children : <p role="status">Opening your notes…</p>;
}
