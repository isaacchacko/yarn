import { Radar } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Agent, SentrySession } from "@/mock";
import { useResource } from "@/lib/effects";
import { cn } from "@/lib/utils";
import { agentStore, sentryStore } from "@/store";
import { ago } from "@/threads/Replies";
import { isRecord } from "../../shared/guards";

const REVIEW_QUEUE_WORKERS = "vis-factory";
const SENTRIES = ["funnel", "assistant", "review", "meta", "inbox", "approval", "gh", "slack", "graph", "rename", "ram", "health", REVIEW_QUEUE_WORKERS];
const AGENTS = new Set(["funnel", "assistant", "review", "meta", REVIEW_QUEUE_WORKERS]);

type Switch = { name: string; off: { at: number; by: string } | null; wanted: boolean };
type Switches = { readable: boolean; sentries: Switch[] };
const isSwitches = (value: unknown): value is Switches => isRecord(value) && Array.isArray(value["sentries"]);

async function send(init?: RequestInit): Promise<Switches> {
  const res = await fetch(init ? "/api/sentries/switch" : "/api/sentries", init);
  if (!res.ok) throw new Error(await res.text());
  const answer: unknown = await res.json();
  if (!isSwitches(answer)) throw new Error("The server didn't answer with the sentries");
  return answer;
}

const loadSwitches = async () => send();

function stateText(name: string, s: SentrySession | undefined, workers: Agent[], sw: Switch | undefined) {
  if (name === REVIEW_QUEUE_WORKERS) return `${workers.length} workers`;
  if (sw?.off) return "switched off";
  if (!s) return "not started";
  return s.running ? "running" : "exited";
}

function tiesText(s: SentrySession | undefined, agents: Agent[]) {
  if (!s || s.ties.length === 0) return "";
  return s.ties.map(t => `${agents.find(a => a.id === t.session)?.name ?? t.session} (${t.label})`).join(", ");
}

function hrefOf(s: SentrySession | undefined, workers: Agent[]) {
  if (s) return `#agent/${s.id}`;
  const [firstWorker] = workers;
  return firstWorker ? `#agent/${firstWorker.id}` : undefined;
}

function RowLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (href === undefined)
    return <div className="flex items-center gap-3 px-3 py-2 opacity-60">{children}</div>;
  return (
    <a href={href} className="flex items-center gap-3 px-3 py-2 hover:bg-muted">
      {children}
    </a>
  );
}

function OnOff({ sw, flip }: { sw: Switch | undefined; flip: (isOff: boolean) => void }) {
  if (!sw) return <span className="mr-3 w-16 shrink-0" />;
  const isOff = sw.off !== null;
  return (
    <Button size="xs" variant="outline" className="mr-3 w-16 shrink-0" title={isOff ? `off since ${new Date(sw.off?.at ?? 0).toLocaleString()} by ${sw.off?.by ?? ""}` : undefined} onClick={() => { flip(!isOff); }}>
      {isOff ? "Turn on" : "Turn off"}
    </Button>
  );
}

function SentryRow({ name, sentries, agents, sw, flip }: { name: string; sentries: SentrySession[]; agents: Agent[]; sw: Switch | undefined; flip: (isOff: boolean) => void }) {
  const s = sentries.find(x => x.name === name);
  const isReviewQueue = name === REVIEW_QUEUE_WORKERS;
  const workers = isReviewQueue ? agents.filter(a => a.name === "vis factory worker") : [];
  const isRunning = isReviewQueue ? workers.length > 0 : s?.running === true;
  return (
    <li className="flex items-center border-b last:border-b-0">
      <div className="min-w-0 flex-1">
        <RowLink href={hrefOf(s, workers)}>
          <span className={cn("size-2 shrink-0 rounded-full", isRunning ? "bg-ok" : "bg-muted-foreground/40")} />
          <Radar className="size-3.5 shrink-0 text-command" />
          <span className="w-28 shrink-0 font-mono text-sm">{name}</span>
          <span className="w-16 shrink-0 text-xs text-muted-foreground">{(s?.agent ?? AGENTS.has(name)) ? "agent" : "script"}</span>
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{stateText(name, s, workers, sw)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{tiesText(s, agents)}</span>
          {s && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{ago(s.lastOutputAt)}</span>}
        </RowLink>
      </div>
      <OnOff sw={sw} flip={flip} />
    </li>
  );
}

export function SentriesView() {
  const sentries = sentryStore.use();
  const agents = agentStore.use();
  const upNow = sentries.filter(s => s.running).map(s => s.name).sort().join(",");
  const switches = useResource(`sentry-switches:${upNow}`, loadSwitches);
  const [error, setError] = useState<string>();
  const flip = async (name: string, isOff: boolean) => {
    try {
      const next = await send({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, off: isOff }) });
      switches.set(() => next);
      setError(undefined);
    } catch (error_) {
      setError(String(error_));
    }
  };
  const names = [...SENTRIES, ...(switches.value?.sentries ?? []).map(sw => sw.name).filter(n => !SENTRIES.includes(n))];

  return (
    <div className="h-full overflow-y-auto p-3">
      {switches.value?.readable === false && <p className="mb-2 text-xs text-destructive">sentries-off.json is unreadable: yarn starts and stops no sentry until it's fixed</p>}
      {error !== undefined && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <ol className="flex flex-col border">
        {names.map(name => (
          <SentryRow key={name} name={name} sentries={sentries} agents={agents} sw={switches.value?.sentries.find(sw => sw.name === name)} flip={isOff => { void flip(name, isOff); }} />
        ))}
      </ol>
    </div>
  );
}
