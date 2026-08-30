// Client-side persistence of recently loaded builds -- localStorage only, nothing leaves the
// machine (matches the app's existing local-first framing, App.tsx). Stores the raw BuildInput,
// not the server's buildId: packages/api's BuildStore is in-memory and clears on restart
// (packages/api/src/builds/store.ts), so a build reload must be able to re-submit the original
// pasted code/XML.

import type { BuildInput, BuildSummary } from "@poe2/contract";

export interface RecentBuild {
  input: BuildInput;
  label: string;
  savedAt: number;
}

const KEY = "poe2-recent-builds";
const MAX_ENTRIES = 5;

export function loadRecentBuilds(): RecentBuild[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentBuild[]) : [];
  } catch {
    return [];
  }
}

function sameInput(a: BuildInput, b: BuildInput): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "pobCode" ? a.code === (b as typeof a).code : a.xml === (b as typeof a).xml;
}

function labelFor(summary: BuildSummary): string {
  const asc = summary.ascendancy ? ` (${summary.ascendancy})` : "";
  return `${summary.className}${asc} · lvl ${summary.level}`;
}

export function saveRecentBuild(input: BuildInput, summary: BuildSummary): void {
  const existing = loadRecentBuilds().filter((r) => !sameInput(r.input, input));
  const next: RecentBuild[] = [
    { input, label: labelFor(summary), savedAt: Date.now() },
    ...existing,
  ].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage disabled -- best effort, not fatal to the load flow.
  }
}
