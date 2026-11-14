"use client";

import { createContext, useContext } from "react";
import type { PortalRole } from "./portal-model";

export type PortalSession = {
  id: string;
  name: string;
  email: string;
  role: PortalRole;
};
export const PortalSessionContext = createContext<PortalSession | null>(null);

export function usePortalSession() {
  const session = useContext(PortalSessionContext);
  if (!session) throw new Error("An authenticated portal session is required.");
  return session;
}
