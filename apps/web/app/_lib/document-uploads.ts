export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_QUEUE_MAX_FILES = 20;
export const DOCUMENT_QUEUE_MAX_BYTES = 100 * 1024 * 1024;
export const DOCUMENT_UPLOAD_CONCURRENCY = 2;

export function validateDocumentFile(
  file: Pick<File, "name" | "size">,
  format?: "pdf" | "docx",
): string | null {
  if (!file.size || file.size > DOCUMENT_MAX_BYTES)
    return "Choose a nonempty file up to 20 MB.";
  if (/\.doc$/i.test(file.name))
    return "This is an older Word (.doc) file. Save or export it as DOCX or PDF, then choose the converted file.";
  if (!/\.(pdf|docx)$/i.test(file.name))
    return "Choose a PDF or DOCX file. Convert this file before adding it again.";
  if (format && !file.name.toLowerCase().endsWith(`.${format}`))
    return `This document requires a ${format.toUpperCase()} file. Use the same format as the original.`;
  return null;
}

export function uploadErrorMessage(error: unknown): string {
  if (
    error instanceof TypeError &&
    /fetch|network|load failed/i.test(error.message)
  )
    return "The upload connection was interrupted. Check your connection and retry this file. Files already saved are retained.";
  return error instanceof Error && error.message
    ? error.message
    : "The upload could not finish. Check your connection and try again.";
}

/** Keep work bounded even when a picker or drop provides many files. */
export async function runUploadWorkers<T>(
  tasks: readonly T[],
  run: (task: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(DOCUMENT_UPLOAD_CONCURRENCY, tasks.length) },
      async () => {
        while (next < tasks.length) {
          const task = tasks[next++];
          await run(task);
        }
      },
    ),
  );
}
