import type { Router } from "express";
import { z } from "zod";
import { asyncHandler, principal } from "@weatherly/platform";
import {
  mergeFieldConfiguration,
  saveCompanyMergeProfile,
  saveFieldDefinition,
  saveMergeSettings,
  saveTransactionDetail,
  transactionDetailFields,
} from "./field-sources";
import { renderEmailFields } from "./render-email-fields";

export function registerMergeFieldRoutes(router: Router) {
  router.get(
    "/field-configuration",
    asyncHandler(async (req, res) =>
      res
        .set("Cache-Control", "private, no-store")
        .json(await mergeFieldConfiguration(principal(req))),
    ),
  );
  router.post(
    "/field-definitions",
    asyncHandler(async (req, res) =>
      res.status(201).json(await saveFieldDefinition(principal(req), req.body)),
    ),
  );
  router.patch(
    "/field-settings",
    asyncHandler(async (req, res) =>
      res.json(await saveMergeSettings(principal(req), req.body)),
    ),
  );
  router.post(
    "/company-field-settings",
    asyncHandler(async (req, res) =>
      res.json(await saveCompanyMergeProfile(principal(req), req.body)),
    ),
  );
  router.get(
    "/matters/:matterId/details",
    asyncHandler(async (req, res) =>
      res
        .set("Cache-Control", "private, no-store")
        .json(
          await transactionDetailFields(
            principal(req),
            String(req.params.matterId),
          ),
        ),
    ),
  );
  router.patch(
    "/matters/:matterId/details",
    asyncHandler(async (req, res) =>
      res.json(
        await saveTransactionDetail(
          principal(req),
          String(req.params.matterId),
          req.body,
        ),
      ),
    ),
  );
  router.post(
    "/render-fields",
    asyncHandler(async (req, res) => {
      const data = z
        .object({
          matterId: z.string().min(1),
          subject: z.string().max(998),
          body: z.string().max(1000000),
          bodyFormat: z.enum(["plain", "html"]).default("plain"),
          values: z.record(z.string(), z.string().max(8000)).optional(),
          templateId: z.string().min(1).optional(),
        })
        .strict()
        .parse(req.body);
      res
        .set("Cache-Control", "private, no-store")
        .json(
          await renderEmailFields(
            principal(req),
            data.matterId,
            data.subject,
            data.body,
            undefined,
            data.values,
            data.templateId,
            data.bodyFormat,
          ),
        );
    }),
  );
}
