import { HttpError } from "@weatherly/platform";
import { generateStructured } from "../gateway";
import { creationRuntimePrompt } from "./prompt";
import { creationProposalSchema, normalizeCreationProposal } from "./proposal";
import type { CreationSources } from "./source-bundle";

export async function extractCreationProposal(
  sources: CreationSources | null,
  {
    signal,
    generate = generateStructured,
  }: {
    signal?: AbortSignal;
    generate?: typeof generateStructured;
  } = {},
) {
  if (!sources)
    return { status: "unavailable", reason: "source_unavailable" } as const;
  const budget = AbortSignal.timeout(60000);
  const deadline = signal ? AbortSignal.any([signal, budget]) : budget;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (deadline.aborted)
      return { status: "unavailable", reason: "interrupted" } as const;
    try {
      const result = await generate({
        purpose: "document_extraction",
        instructions: creationRuntimePrompt,
        data: sources,
        schema: creationProposalSchema,
        signal: deadline,
      });
      if (deadline.aborted)
        return { status: "unavailable", reason: "interrupted" } as const;
      return {
        status: "proposed",
        proposal: normalizeCreationProposal(result.data, sources),
        model: result.model,
        provider: result.provider,
      } as const;
    } catch (error) {
      if (deadline.aborted)
        return { status: "unavailable", reason: "interrupted" } as const;
      const invalid =
        error instanceof HttpError &&
        ["AI_INVALID_RESULT", "AI_EMPTY_RESULT"].includes(error.code);
      if (!invalid)
        return {
          status: "unavailable",
          reason: "provider_unavailable",
        } as const;
    }
  }
  return { status: "unavailable", reason: "invalid_response" } as const;
}
