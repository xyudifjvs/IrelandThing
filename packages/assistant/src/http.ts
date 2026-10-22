import { Router } from "express";
import { queryStoredRecords } from "./records";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import {
  asyncHandler,
  principal,
  assertCoordinator,
} from "@weatherly/platform";
import {
  askAssistant,
  listConversations,
  readMatterBundle,
  searchEvidence,
} from "./service";
import {
  registerClient,
  consentDetails,
  approveConsent,
  revokeGrant,
} from "./access";
export function createAssistantRouter() {
  const r = Router();
  r.get(
    "/records",
    asyncHandler(async (req, res) =>
      res.json(
        await queryStoredRecords(principal(req), {
          kind: req.query.kind,
          matterId: req.query.matterId,
          cursor: req.query.cursor,
          limit: req.query.limit ? Number(req.query.limit) : 50,
        }),
      ),
    ),
  );
  r.post(
    "/ask",
    asyncHandler(async (req, res) =>
      res.json(await askAssistant(principal(req), req.body)),
    ),
  );
  r.get(
    "/conversations",
    asyncHandler(async (req, res) =>
      res.json(await listConversations(principal(req))),
    ),
  );
  r.get(
    "/matters/:id",
    asyncHandler(async (req, res) =>
      res.json(await readMatterBundle(principal(req), String(req.params.id))),
    ),
  );
  r.get(
    "/search",
    asyncHandler(async (req, res) =>
      res.json(
        await searchEvidence(principal(req), {
          query: String(req.query.q || ""),
          cursor:
            typeof req.query.cursor === "string" ? req.query.cursor : undefined,
          matterId:
            typeof req.query.matterId === "string"
              ? req.query.matterId
              : undefined,
        }),
      ),
    ),
  );
  r.post(
    "/clients",
    asyncHandler(async (req, res) =>
      res.status(201).json(await registerClient(principal(req), req.body)),
    ),
  );
  r.get(
    "/grants",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      res.json(
        await prisma.assistantGrant.findMany({
          where: { userId: actor.id },
          select: {
            id: true,
            name: true,
            clientId: true,
            scopes: true,
            expiresAt: true,
            revokedAt: true,
            createdAt: true,
          },
        }),
      );
    }),
  );
  r.delete(
    "/grants/:id",
    asyncHandler(async (req, res) =>
      res.json(await revokeGrant(principal(req), String(req.params.id))),
    ),
  );
  r.get(
    "/consent/:id",
    asyncHandler(async (req, res) =>
      res.json(await consentDetails(principal(req), String(req.params.id))),
    ),
  );
  r.post(
    "/consent/:id",
    asyncHandler(async (req, res) => {
      const { approved } = z
        .object({ approved: z.boolean() })
        .strict()
        .parse(req.body);
      res.json(
        await approveConsent(principal(req), String(req.params.id), approved),
      );
    }),
  );
  return r;
}
