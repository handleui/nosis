import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const WORKER_SRC_ROOT = join(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const FORBIDDEN_IMPORT_PATTERN = /from\s+["']@nosis\/agent-runtime["']/g;

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    const extension = fullPath.slice(fullPath.lastIndexOf("."));
    if (SOURCE_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

test("worker source does not import runtime root package", () => {
  const files = collectSourceFiles(WORKER_SRC_ROOT);
  const violations: string[] = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    if (FORBIDDEN_IMPORT_PATTERN.test(content)) {
      violations.push(filePath);
    }
  }

  assert.deepEqual(violations, []);
});
