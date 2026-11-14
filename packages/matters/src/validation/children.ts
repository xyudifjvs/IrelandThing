import { z } from "zod";
import { taskVisibility, taskNote, taskAppointment, taskDetails } from "./task-fields";
import { dateOnly } from "./common";
import { deadlineDetails } from "./deadline-fields";

export const taskInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    kind: z.string().max(80).default("checklist"),
    status: z
      .enum([
        "pending",
        "received",
        "proposed",
        "completed",
        "signed",
        "not_applicable",
      ])
      .default("pending"),
    visibility: taskVisibility.default("agent"),
    dueDate: dateOnly.nullable().optional(),
    note: taskNote.optional(),
    appointmentAt: taskAppointment.optional(),
    details: taskDetails.default({}),
  })
  .strict();

export const deadlineInput = z
  .object({
    label: z.string().trim().min(1).max(200),
    date: dateOnly.nullable().optional(),
    status: z
      .enum(["unknown", "proposed", "confirmed", "rejected"])
      .default("unknown"),
    sourceDocumentId: z.string().nullable().optional(),
    visibility: taskVisibility.optional(),
    details: deadlineDetails.default({}),
  })
  .strict();
