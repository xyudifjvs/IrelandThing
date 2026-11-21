"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { FileGroup } from "./portal-model";

type BrowseState = {
  group: FileGroup;
  search: string;
  setGroup: (group: FileGroup) => void;
  setSearch: (search: string) => void;
};
const AgentBrowseContext = createContext<BrowseState | null>(null);

/** Kept in the authenticated layout so returning to the list preserves its view.
 * Search text stays in memory and resets when the signed-in user changes. */
export function AgentBrowseProvider({ children }: { children: ReactNode }) {
  const [group, setGroup] = useState<FileGroup>("active");
  const [search, setSearch] = useState("");
  return (
    <AgentBrowseContext.Provider value={{ group, search, setGroup, setSearch }}>
      {children}
    </AgentBrowseContext.Provider>
  );
}

export function useAgentBrowse() {
  const state = useContext(AgentBrowseContext);
  if (!state)
    throw new Error("An authenticated agent browse session is required.");
  return state;
}
