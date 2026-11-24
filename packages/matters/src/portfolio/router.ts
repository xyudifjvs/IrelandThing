import { Router } from "express";
import {
  assertCoordinator,
  asyncHandler,
  principal,
  type Principal,
} from "@weatherly/platform";
import { prisma } from "@weatherly/db";
import { listNewIntakes } from "./intakes";
import { listPortfolioCalendar, listPortfolioDue } from "./calendar";
import { listAgentCalendar } from "./agent-calendar";
import {
  listPortfolioTransactions,
  pagination,
  type PortfolioDependencies,
} from "./transactions";

export { listPortfolioCalendar, listPortfolioDue } from "./calendar";
export {
  listPortfolioTransactions,
  type PortfolioDependencies,
} from "./transactions";

async function listEmailAttention(actor: Principal) {
  assertCoordinator(actor);
  return prisma.$queryRaw<
    {
      id: string;
      matterId: string;
      propertyAddress: string;
      subject: string;
      status: string;
      total: bigint;
    }[]
  >`
    SELECT d.id, d."matterId", m."propertyAddress", d.subject, d.status,
           count(*) OVER () AS total
    FROM "EmailDraft" d JOIN "Matter" m ON m.id = d."matterId"
    WHERE d."createdById" = ${actor.id}
      AND m.stage IN ('under_contract', 'closing', 'listing')
      AND (d.status IN ('failed', 'delivery_unknown') OR (
        d.status IN ('queued', 'sending') AND EXISTS (
          SELECT 1 FROM "OutboxJob" j WHERE j."idempotencyKey" = d."sendKey"
            AND j.topic = 'gmail.send' AND j.state = 'failed'
        )
      ))
    ORDER BY d."updatedAt" DESC, d.id DESC
    LIMIT 1
  `.then(([latest]) =>
    latest ? { ...latest, total: Number(latest.total) } : null,
  );
}

export function createPortfolioRouter(dependencies: PortfolioDependencies) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get(
    "/transactions",
    asyncHandler(async (req, res) => {
      res.json(
        await listPortfolioTransactions(
          principal(req),
          req.query,
          dependencies,
        ),
      );
    }),
  );
  router.get(
    "/agent-calendar",
    asyncHandler(async (req, res) => {
      res.json(await listAgentCalendar(principal(req), req.query));
    }),
  );
  router.get(
    "/calendar",
    asyncHandler(async (req, res) => {
      res.json(await listPortfolioCalendar(principal(req), req.query));
    }),
  );
  router.get(
    "/due",
    asyncHandler(async (req, res) => {
      res.json(await listPortfolioDue(principal(req), dependencies));
    }),
  );
  router.get(
    "/intakes",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const { page, limit } = pagination.strict().parse(req.query);
      res.json(await listNewIntakes(actor, page, limit));
    }),
  );
  router.get(
    "/email-attention",
    asyncHandler(async (req, res) => {
      res.json(await listEmailAttention(principal(req)));
    }),
  );
  return router;
}
