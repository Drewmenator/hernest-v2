// Vercel Hobby allows max 12 serverless functions per deployment. Exceeding
// it fails the deploy SILENTLY at "Deploying outputs..." (it has bitten us
// twice). Every .js file directly under api/ (excluding _lib and tests) is
// one function — this test fails the suite before the deploy can.
import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT = 12;

function countFunctions(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "_lib") continue;
      count += countFunctions(full);
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      count++;
    }
  }
  return count;
}

describe("Vercel function limit", () => {
  it(`api/ has at most ${LIMIT} serverless functions (Hobby plan cap)`, () => {
    const count = countFunctions(API_DIR);
    expect(count, `api/ has ${count} functions — Hobby caps at ${LIMIT}; consolidate before deploying`).toBeLessThanOrEqual(LIMIT);
  });
});
