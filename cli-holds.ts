import { argAt, call, fail, hasArg, listAt, mySession, post, replies, replyOf, type Verb } from "./cli-shared";
import { didUnhold, hold, holds, prKeyOf } from "./holds";

function repoHere() {
  const r = Bun.spawnSync(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { stderr: "pipe" });
  if (r.exitCode !== 0) fail("a bare PR number needs a GitHub repo checked out here; pass owner/repo#n or the PR's url");
  return r.stdout.toString().trim();
}

function keyOf(ref: string) {
  return prKeyOf(ref, repoHere) ?? fail(`not a PR: ${ref} (pass a url, owner/repo#n, or a number in its repo's checkout)`);
}

function holdPr(args: string[]) {
  const key = keyOf(argAt(args, 0));
  const why = args.slice(1).join(" ");
  const by = mySession();
  hold(key, by === undefined || by === "" ? "isaac" : by, why);
  console.log(`held ${key}: the review and approval sentries leave it alone until \`yarn unhold ${key}\``);
}

function unholdPr(args: string[]) {
  const key = keyOf(argAt(args, 0));
  console.log(didUnhold(key) ? `unheld ${key}` : `${key} wasn't held`);
}

function listHolds() {
  for (const [key, h] of Object.entries(holds())) console.log(`${key}  since ${new Date(h.at).toLocaleString()}  by ${h.by}${h.why === "" ? "" : `  ${h.why}`}`);
}

function printSentries(reply: unknown) {
  const r = replyOf(reply);
  if (r["readable"] === false) console.log("sentries-off.json is unreadable: yarn starts and stops no sentry until it's fixed");
  for (const s of replies(listAt(r, "sentries"))) {
    const off = replyOf(s["off"]);
    const state = s["off"] === null ? "on " : "off";
    const why = s["off"] === null ? (s["wanted"] === false ? "  (not in YARN_SENTRIES, so it never starts)" : "") : `  since ${new Date(Number(off["at"])).toLocaleString()} by ${String(off["by"])}`;
    console.log(`${state}  ${s["running"] === true ? "running" : "stopped"}  ${String(s["name"])}${why}`);
  }
}

async function switchSentry(args: string[], isOff: boolean) {
  const name = argAt(args, 0).replace(/^sentry:/, "");
  const r = replyOf(await post("/api/sentries/switch", { name, off: isOff }));
  const s = replies(listAt(r, "sentries")).find((x) => x["name"] === name);
  if (isOff && s?.["running"] === true) fail(`${name} is off, but its session is still up; see \`yarn sentry ls\``);
  if (isOff) console.log(`${name} is off: its session is stopped, and yarn won't start it again (boot, respawn or deploy) until \`yarn sentry on ${name}\``);
  else console.log(s?.["wanted"] === false ? `${name} is on, but YARN_SENTRIES leaves it out, so it won't start` : `${name} is on, and yarn started it`);
}

export const holdVerbs: Verb[] = [
  { matches: (verb, args) => verb === "sentry" && args[0] === "ls", run: async () => { printSentries(await call("/api/sentries")); } },
  { matches: (verb, args) => verb === "sentry" && (args[0] === "off" || args[0] === "on") && hasArg(args, 1), run: async (args) => { await switchSentry(args.slice(1), args[0] === "off"); } },
  { matches: (verb, args) => verb === "hold" && hasArg(args, 0), run: holdPr },
  { matches: (verb, args) => verb === "unhold" && hasArg(args, 0), run: unholdPr },
  { matches: (verb) => verb === "holds", run: listHolds },
];
