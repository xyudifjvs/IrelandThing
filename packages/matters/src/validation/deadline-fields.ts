import { z } from "zod";
import { taskVisibility } from "./task-fields";

export const deadlineDetails = z
  .record(z.string(), z.json())
  .superRefine((details, context) => {
    if (
      Object.hasOwn(details, "visibility") &&
      !taskVisibility.safeParse(details.visibility).success
    )
      context.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "Choose a valid deadline audience.",
      });
  });
