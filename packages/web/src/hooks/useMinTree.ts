// Loads + parses packages/web/public/tree-0_5.min.json once, for the result canvas. Committed
// artifact (docs/web-ui/08-fork-prep.md task 6) -- no API round-trip, no submodule.

import { useEffect, useState } from "react";
import { parseMinTree } from "../render/minTree";
import type { MinTree } from "../render/types";

export type MinTreeState =
  | { status: "loading" }
  | { status: "ready"; tree: MinTree }
  | { status: "error"; message: string };

let cache: MinTree | null = null;

export function useMinTree(): MinTreeState {
  const [state, setState] = useState<MinTreeState>(
    cache ? { status: "ready", tree: cache } : { status: "loading" },
  );

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    const url = `${import.meta.env.BASE_URL}tree-0_5.min.json`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((raw) => {
        if (cancelled) return;
        cache = parseMinTree(raw);
        setState({ status: "ready", tree: cache });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
