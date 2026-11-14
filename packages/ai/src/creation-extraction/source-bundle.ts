import { z } from "zod";
import type { SourceVersion } from "@weatherly/platform/handoff-contracts";

const pageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
});

export type ExtractedVersion = SourceVersion & {
  processingStatus: string;
  pages: unknown;
};

/** Send the entire pinned packet, or leave review available for manual entry. */
export function assembleCreationSources(
  pins: readonly SourceVersion[],
  versions: readonly ExtractedVersion[],
) {
  if (pins.length === 0) return null;
  const seen = new Set<string>();
  const byVersion = new Map(
    versions.map((version) => [version.versionId, version]),
  );
  const documents = [];
  for (const pin of pins) {
    const version = byVersion.get(pin.versionId);
    if (
      !version ||
      version.documentId !== pin.documentId ||
      version.processingStatus !== "complete" ||
      seen.has(pin.documentId)
    )
      return null;
    const pages = z.array(pageSchema).min(1).max(250).safeParse(version.pages);
    if (!pages.success) return null;
    const orderedPages = [...pages.data].sort((a, b) => a.page - b.page);
    if (
      orderedPages.some(
        (page, index) => page.page !== index + 1 || !page.text.trim(),
      )
    ) {
      return null;
    }
    seen.add(pin.documentId);
    documents.push({ ...pin, pages: orderedPages });
  }
  return { documents };
}

export type CreationSources = NonNullable<
  ReturnType<typeof assembleCreationSources>
>;
