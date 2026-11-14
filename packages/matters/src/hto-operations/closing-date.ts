import { HttpError, type Principal } from "@weatherly/platform";
import {
  checklistDateApplySchema,
  civilDateSchema,
  revisionSchema,
} from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import {
  applyMatterChecklistDates,
  previewMatterChecklistDates,
} from "../checklist/date-commands";
import { withLinkedClosing } from "./linked";
import { closingDateEditable } from "./queries";

const previewInput = z
  .object({
    expectedRevision: revisionSchema,
    date: civilDateSchema.nullable(),
  })
  .strict();
const applyInput = previewInput.extend(
  checklistDateApplySchema.pick({ mode: true, previewDigest: true }).shape,
);

export type HtoClosingDateCommands = {
  preview: typeof previewMatterChecklistDates;
  apply: typeof applyMatterChecklistDates;
  historicalDateEdits?: boolean;
};

const defaultCommands: HtoClosingDateCommands = {
  preview: previewMatterChecklistDates,
  apply: applyMatterChecklistDates,
};

function closingDateChange(date: string | null) {
  return {
    kind: "set",
    target: { kind: "step", key: "closing" },
    value: date ? { date, instant: null } : null,
  };
}

function rejectUnavailableDate() {
  throw new HttpError(
    409,
    "HTO_CLOSING_DATE_UNAVAILABLE",
    "This file's closing date cannot be edited here.",
  );
}

export async function previewLinkedClosingDate(
  actor: Principal,
  id: string,
  raw: unknown,
  commands = defaultCommands,
) {
  return withLinkedClosing(actor, id, (tx, _row, matter) => {
    if (!closingDateEditable(matter, commands.historicalDateEdits === true))
      rejectUnavailableDate();
    const { date, expectedRevision } = previewInput.parse(raw);
    return commands.preview(
      actor,
      matter.id,
      { expectedRevision, change: closingDateChange(date) },
      tx,
    );
  });
}

export async function applyLinkedClosingDate(
  actor: Principal,
  id: string,
  raw: unknown,
  commands = defaultCommands,
) {
  return withLinkedClosing(actor, id, (tx, _row, matter) => {
    if (!closingDateEditable(matter, commands.historicalDateEdits === true))
      rejectUnavailableDate();
    const { date, ...command } = applyInput.parse(raw);
    return commands.apply(
      actor,
      matter.id,
      { ...command, change: closingDateChange(date) },
      tx,
    );
  });
}
