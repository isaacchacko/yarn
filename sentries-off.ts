import { isRecord } from "./shared/guards";
import { hasState, peekStateJson, writeStateJson } from "./state";

export type SentryOff = { at: number; by: string };
type SentriesOff = Record<string, SentryOff>;

const OFF_FILE = "sentries-off.json";

const isSentriesOff = (value: unknown): value is SentriesOff => isRecord(value) && Object.values(value).every((o) => isRecord(o) && typeof o["at"] === "number");

// constraint: an unreadable file must not quietly turn a sentry he switched off back on, so callers start and stop nothing until it's fixed
export function sentriesOff(): SentriesOff | undefined {
  const all = peekStateJson(OFF_FILE);
  if (isSentriesOff(all)) return all;
  return hasState(OFF_FILE) ? undefined : {};
}

export const isSentryOff = (name: string) => sentriesOff()?.[name] !== undefined;

export function setSentryOff(name: string, isOff: boolean, by: string) {
  const all = sentriesOff();
  if (all === undefined) throw new Error(`${OFF_FILE} is unreadable; fix or delete it first`);
  const kept = Object.fromEntries(Object.entries(all).filter(([n]) => n !== name));
  writeStateJson(OFF_FILE, isOff ? { ...kept, [name]: { at: Date.now(), by } } : kept);
}
