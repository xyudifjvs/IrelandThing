// Independent C00 reviewer probe. Reads source only; no database/provider access.
// Usage: node docs/reviews/intake-to-transaction/C00/preservation-probe.mjs [candidate-root]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const baseline = "2177674877bc97c3371f94b331aa5e18a2e69e07";
const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const candidateRoot = path.resolve(process.argv[2] || repository);
const sources = [
  "packages/matters/src/index.ts",
  "packages/matters/src/task-fields.ts",
  "packages/matters/src/deadline-fields.ts",
  "apps/web/app/(workspace)/workspace/_components/Operations.tsx",
  "apps/web/app/(workspace)/workspace/transactions/[id]/page.tsx",
];
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const print = (node, file) => printer.printNode(ts.EmitHint.Unspecified, node, file);
const gitRead = (name) => execFileSync("git", ["show", `${baseline}:${name}`], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
function declarations(name, source) {
  const file = parse(name, source);
  const result = [];
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const signature = [
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async" : "sync",
        node.typeParameters?.map((p) => print(p, file)).join(",") || "",
        node.parameters.map((p) => print(p, file)).join(","),
        node.type ? print(node.type, file) : "",
        print(node.body, file),
      ].join("\n");
      result.push({ name: node.name.text, kind: "function", hash: hash(signature), file: name });
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) result.push({ name: declaration.name.text, kind: "variable", hash: hash(print(declaration, file)), file: name });
      }
    }
  }
  return result;
}
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : [];
  });
}
const original = sources.flatMap((name) => declarations(name, gitRead(name)));
const candidateFiles = [
  ...walk(path.join(candidateRoot, "packages/matters/src")),
  ...walk(path.join(candidateRoot, "apps/web/app/(workspace)/workspace")),
];
const candidate = candidateFiles.flatMap((full) => declarations(path.relative(candidateRoot, full), fs.readFileSync(full, "utf8")));
const comparison = original.map((entry) => {
  const named = candidate.filter((other) => other.name === entry.name && other.kind === entry.kind);
  const equivalent = named.filter((other) => other.hash === entry.hash);
  return { name: entry.name, kind: entry.kind, baselineFile: entry.file, status: equivalent.length ? "preserved" : named.length ? "changed-needs-review" : "not-found-needs-review", candidateFiles: (equivalent.length ? equivalent : named).map((other) => other.file) };
});
function exportNames(name, read, visited = new Set()) {
  if (visited.has(name)) return [];
  visited.add(name);
  const file = parse(name, read(name));
  const names = [];
  for (const node of file.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) names.push(...node.exportClause.elements.map((e) => e.name.text));
      else if (!node.exportClause && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(".")) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(name), node.moduleSpecifier.text));
        for (const next of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
          try { names.push(...exportNames(next, read, visited)); break; } catch {}
        }
      }
    }
    if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(node)) names.push(...node.declarationList.declarations.filter((d) => ts.isIdentifier(d.name)).map((d) => d.name.text));
    else if (node.name && ts.isIdentifier(node.name)) names.push(node.name.text);
  }
  return [...new Set(names)].sort();
}
const exports = sources.slice(0, 3).map((name) => {
  const before = exportNames(name, gitRead);
  const after = exportNames(name, (relative) => fs.readFileSync(path.join(candidateRoot, relative), "utf8"));
  return { file: name, baselineCount: before.length, candidateCount: after.length, missing: before.filter((e) => !after.includes(e)), added: after.filter((e) => !before.includes(e)) };
});
console.log(JSON.stringify({ baseline, candidateRoot, exportCompatibility: exports, declarationSummary: { total: comparison.length, preserved: comparison.filter((r) => r.status === "preserved").length, changed: comparison.filter((r) => r.status === "changed-needs-review").length, notFound: comparison.filter((r) => r.status === "not-found-needs-review").length }, declarations: comparison }, null, 2));
