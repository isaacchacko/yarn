import { yarnEnv } from "./shared/legacy-maxflow";
import { publish } from "./bus";
import { DIR } from "./instance";
import { stateDisplayPath } from "./state";
import { setOption } from "./tmux";
import { type Session, sessions } from "./sessions";
import { createSession, killSession } from "./lifecycle";
import { patch } from "./patch";
import { SENTRIES } from "./sentry-commands";
import { BARE_AGENT_SENTRIES, FED_AGENT_SENTRIES } from "./sentry-names";
import { sentriesOff, setSentryOff } from "./sentries-off";

const SENTRY_CHECK_MS = 15_000;
const FIRST_RESPAWN_AFTER_MS = 30_000;
const LONGEST_RESPAWN_BACKOFF_MS = 30 * 60_000;
const UP_THIS_LONG_RESETS_BACKOFF_MS = 10 * 60_000;
const SENTRY_PREFIX_LENGTH = "sentry:".length;

const sentrySource = (file: string) => new URL(`sentries/${file}`, import.meta.url).pathname;
const agentWithBrief = (name: string) => `exec claude --permission-mode bypassPermissions --append-system-prompt "$(cat "${sentrySource(`${name}.md`)}")"`;

function registerAgentSentriesWithFeedsLoggedAside() {
  for (const n of FED_AGENT_SENTRIES)
    SENTRIES[`sentry:${n}`] = ["sh", "-c", `"${process.execPath}" "${sentrySource(`${n}.ts`)}" >"${stateDisplayPath(`${n}-feed.log`)}" 2>&1 & ${agentWithBrief(n)}`];
  for (const n of BARE_AGENT_SENTRIES) SENTRIES[`sentry:${n}`] = ["sh", "-c", agentWithBrief(n)];
}

function markSentry(s: Session) {
  patch(s, { sentry: true });
  setOption(s.id, "@mf-sentry", "1");
}

function markSentriesStartedBeforeTheFlagByNameAndScript() {
  for (const s of sessions.values()) if (s.sentry !== true && Object.hasOwn(SENTRIES, s.name) && s.cmd.join(" ").includes(sentrySource(""))) markSentry(s);
}

function sentriesWantedByYarnSentriesEnv(): [string, string[]][] {
  const noneAllOrCommaList = yarnEnv("SENTRIES") ?? "1";
  if (noneAllOrCommaList === "0") return [];
  return Object.entries(SENTRIES).filter(([n]) => noneAllOrCommaList === "1" || noneAllOrCommaList.split(",").includes(n.slice(SENTRY_PREFIX_LENGTH)));
}

const runningSentry = (name: string) => sessions.values().find((s) => s.sentry === true && s.name === name && s.exitCode === null);
const isSentryUp = (name: string) => runningSentry(name) !== undefined;
const bare = (name: string) => name.slice(SENTRY_PREFIX_LENGTH);

const respawns = new Map<string, { tries: number; at: number }>();
function respawnWithBackoffIfDown(name: string, cmd: string[]) {
  const r = respawns.get(name) ?? { tries: 0, at: 0 };
  if (isSentryUp(name)) {
    if (r.tries > 0 && Date.now() - r.at > UP_THIS_LONG_RESETS_BACKOFF_MS) respawns.delete(name);
    return;
  }
  if (Date.now() - r.at < Math.min(FIRST_RESPAWN_AFTER_MS * 2 ** r.tries, LONGEST_RESPAWN_BACKOFF_MS)) return;
  const tries = r.tries + 1;
  respawns.set(name, { tries, at: Date.now() });
  console.log(`${name} is down; starting it again (try ${String(tries)})`);
  markSentry(createSession(name, cmd, DIR));
  publish("sentry/start", { name, why: "respawn", tries });
}

function stopIfRunning(name: string, by: string) {
  const s = runningSentry(name);
  if (!s) return;
  console.log(`${name} is switched off; stopping its session ${s.id}`);
  killSession(s);
  publish("sentry/stop", { name, session: s.id, by });
}

const boot: { wanted: [string, string[]][]; hasWarnedUnreadable: boolean } = { wanted: [], hasWarnedUnreadable: false };

function keepWantedSentriesUpAndSwitchedOffOnesDown() {
  const off = sentriesOff();
  if (off === undefined) {
    if (!boot.hasWarnedUnreadable) console.log("sentries-off.json is unreadable; starting and stopping no sentries until it's fixed");
    boot.hasWarnedUnreadable = true;
    return;
  }
  boot.hasWarnedUnreadable = false;
  for (const [name, cmd] of boot.wanted) {
    const o = off[bare(name)];
    if (o) stopIfRunning(name, o.by);
    else respawnWithBackoffIfDown(name, cmd);
  }
}

export const sentryNames = () => Object.keys(SENTRIES).map(bare);
export const isWantedByYarnSentriesEnv = (name: string) => boot.wanted.some(([n]) => bare(n) === name);
export const isRunning = (name: string) => isSentryUp(`sentry:${name}`);

// constraint: the toggle acts at once rather than on the next 15s check, so `sentry off` returns with the session already gone
export function switchSentry(name: string, isOff: boolean, by: string) {
  setSentryOff(name, isOff, by);
  respawns.delete(`sentry:${name}`);
  publish(`sentry/${isOff ? "off" : "on"}`, { name, by });
  keepWantedSentriesUpAndSwitchedOffOnesDown();
}

export function startSentriesAndKeepThemUp() {
  registerAgentSentriesWithFeedsLoggedAside();
  markSentriesStartedBeforeTheFlagByNameAndScript();
  boot.wanted = sentriesWantedByYarnSentriesEnv();
  const off = sentriesOff();
  for (const [name, cmd] of boot.wanted) {
    if (off === undefined || off[bare(name)] !== undefined || isSentryUp(name)) continue;
    markSentry(createSession(name, cmd, DIR));
    publish("sentry/start", { name, why: "boot" });
  }
  keepWantedSentriesUpAndSwitchedOffOnesDown();
  setInterval(keepWantedSentriesUpAndSwitchedOffOnesDown, SENTRY_CHECK_MS);
}
