import { Router } from "express";
import type { WeatherlyAuth } from "./auth";
import { registerProfileRoutes } from "./profile-routes";
import { registerAccessRoutes } from "./access-routes";
import {
  registerInvitationRoutes,
  type InvitationOptions,
} from "./invitation-routes";

export {
  createAuth,
  authHandler,
  sessionMiddleware,
  type IdentityOptions,
  type WeatherlyAuth,
} from "./auth";
export {
  getAgentMembership,
  hasAgentAgreementAccess,
  type AgentMembership,
} from "./agent-membership";
export type { InvitationOptions } from "./invitation-routes";

export function createIdentityRouter(
  _auth: WeatherlyAuth,
  options: InvitationOptions = {},
) {
  const r = Router();
  registerProfileRoutes(r);
  registerInvitationRoutes(r, options);
  registerAccessRoutes(r);
  return r;
}
