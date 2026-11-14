import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { HttpError } from "@weatherly/platform";

function validateDocxArchive(bytes: Buffer) {
  if (bytes.length < 22)
    throw new HttpError(415, "INVALID_DOCX", "The Word archive is invalid");
  let offset = bytes.length - 22;
  while (
    offset >= Math.max(0, bytes.length - 65558) &&
    bytes.readUInt32LE(offset) !== 0x06054b50
  )
    offset--;
  if (offset < Math.max(0, bytes.length - 65558))
    throw new HttpError(415, "INVALID_DOCX", "The Word archive is invalid");
  const entries = bytes.readUInt16LE(offset + 10);
  let cursor = bytes.readUInt32LE(offset + 16),
    total = 0;
  if (entries > 2000)
    throw new HttpError(
      413,
      "ARCHIVE_TOO_LARGE",
      "Word document has too many embedded files",
    );
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new HttpError(415, "INVALID_DOCX", "The Word archive is invalid");
    const compressed = bytes.readUInt32LE(cursor + 20),
      uncompressed = bytes.readUInt32LE(cursor + 24);
    total += uncompressed;
    if (
      total > 60 * 1024 * 1024 ||
      uncompressed / Math.max(1, compressed) > 1000
    )
      throw new HttpError(
        413,
        "ARCHIVE_TOO_LARGE",
        "Word document expands beyond the safe processing limit",
      );
    cursor +=
      46 +
      bytes.readUInt16LE(cursor + 28) +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
}
export function fileType(name: string, bytes: Buffer, emailAttachment = false) {
  const ext = path.extname(name).toLowerCase();
  if (emailAttachment) {
    if (
      ext === ".png" &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return "image/png";
    if (
      [".jpg", ".jpeg"].includes(ext) &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    )
      return "image/jpeg";
    if ([".txt", ".csv"].includes(ext) && !bytes.includes(0))
      return ext === ".csv" ? "text/csv" : "text/plain";
  }
  if (ext === ".pdf" && bytes.subarray(0, 5).toString() === "%PDF-")
    return "application/pdf";
  if (ext === ".docx" && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    validateDocxArchive(bytes);
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === ".doc")
    throw new HttpError(
      415,
      "CONVERSION_REQUIRED",
      "Save legacy .doc as .docx or PDF and upload again",
    );
  throw new HttpError(
    415,
    "UNSUPPORTED_FILE",
    "Upload a valid PDF or DOCX file",
  );
}
export async function extractDocument(bytes: Buffer, mime: string) {
  if (mime.startsWith("text/")) {
    const text = bytes.toString("utf8");
    return {
      text,
      pages: [{ page: 1, text, anchorType: "document" }],
      status: "complete",
      error: null,
    };
  }
  if (mime.startsWith("image/"))
    return {
      text: "",
      pages: [],
      status: "needs_ocr",
      error:
        "Image original saved; OCR must use the approved OpenRouter gateway",
    };
  if (mime === "application/pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      const info = await parser.getInfo();
      if (info.total > 250)
        throw new HttpError(
          413,
          "TOO_MANY_PAGES",
          "Split PDF files longer than 250 pages",
        );
      const result = await parser.getText();
      return {
        text: result.text,
        pages: result.pages.map((p) => ({ page: p.num, text: p.text })),
        status: result.text.trim() ? "complete" : "needs_ocr",
        error: result.text.trim()
          ? null
          : "This scanned PDF has no extractable text; AI/OCR review must use the approved OpenRouter gateway",
      };
    } finally {
      await parser.destroy();
    }
  }
  const result = await mammoth.extractRawText({ buffer: bytes });
  return {
    text: result.value,
    pages: [
      {
        page: 1,
        text: result.value,
        anchorType: "document",
        pagination: "DOCX has no stable physical page numbers",
      },
    ],
    status: result.value.trim() ? "complete" : "empty",
    error: result.value.trim() ? null : "No text found in this Word document",
  };
}
