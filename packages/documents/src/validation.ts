import { z } from "zod";

export const maxBytes = 20 * 1024 * 1024;
export const visibility = z.enum(["coordinator", "agent", "client"]);
