import { HttpError } from "@weatherly/platform";
import { ChecklistDateError } from "../date-graph/types";

export function translateChecklistDateError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof ChecklistDateError)) throw error;
    const conflict =
      error.code === "REVISION_CONFLICT" || error.code === "PREVIEW_CONFLICT";
    throw new HttpError(conflict ? 409 : 422, error.code, error.message);
  }
}
