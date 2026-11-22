import { noSessionEnv } from "../shared/legacy-maxflow";
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "yarn-sentries-off-"));
const stateDir = join(home, ".yarn-v2-sentriesofftest");
mkdirSync(stateDir, { recursive: true });
const env = { ...process.env, HOME: home, YARN_INSTANCE: "sentriesofftest", YARN_PORT: "1", ...noSessionEnv() };

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

const run = (code: string) => Bun.spawnSync(["bun", "-e", `import { isSentryOff, sentriesOff, setSentryOff } from "./sentries-off"; ${code}`], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
const out = (code: string) => run(code).stdout.toString().trim();

test("no file means every sentry is on", () => {
  expect(out(`console.log(JSON.stringify(sentriesOff()))`)).toBe("{}");
  expect(out(`console.log(isSentryOff("approval"))`)).toBe("false");
});

test("off and on persist in the state file, one sentry at a time", () => {
  run(`setSentryOff("approval", true, "isaac"); setSentryOff("graph", true, "abc123")`);
  expect(out(`console.log(isSentryOff("approval"), isSentryOff("graph"), isSentryOff("gh"))`)).toBe("true true false");
  expect(JSON.parse(out(`console.log(JSON.stringify(sentriesOff()))`))).toMatchObject({ approval: { by: "isaac" }, graph: { by: "abc123" } });
  run(`setSentryOff("graph", false, "abc123")`);
  expect(out(`console.log(isSentryOff("approval"), isSentryOff("graph"))`)).toBe("true false");
});

test("an unreadable file reads as unknown, not as every sentry on, and refuses writes", () => {
  writeFileSync(join(stateDir, "sentries-off.json"), "{not json");
  expect(out(`console.log(String(sentriesOff()))`)).toBe("undefined");
  expect(run(`setSentryOff("approval", false, "x")`).exitCode).not.toBe(0);
});
