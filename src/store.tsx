import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { buildItems } from "./data/mock";
import { rank } from "./lib/priority";
import { nameOf } from "./lib/people";
import type { Override, Ranked, Snooze, Source, SourceHealth, WorkItem } from "./types";

export interface ManagerAction {
  at: number;
  itemId: string;
  text: string;
}

interface State {
  base: WorkItem[];
  overrides: Record<string, Override>;
  log: ManagerAction[];
  health: SourceHealth;
  aiFails: boolean;
  emptyWorkspace: boolean;
  now: number;
}

type Action =
  | { type: "assign"; id: string; to: string | null }
  | { type: "done"; id: string }
  | { type: "reopen"; id: string }
  | { type: "snooze"; id: string; snooze: Snooze }
  | { type: "unsnooze"; id: string }
  | { type: "health"; source: Source; ok: boolean }
  | { type: "aiFails"; on: boolean }
  | { type: "empty"; on: boolean }
  | { type: "tick" }
  | { type: "reset" };

const STORAGE_KEY = "workradar.v1";

function load(): Partial<State> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(s: State) {
  try {
    const { overrides, log, health, aiFails, emptyWorkspace } = s;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ overrides, log, health, aiFails, emptyWorkspace }));
  } catch {
    /* storage unavailable: the demo still works for this session */
  }
}

const HEALTHY: SourceHealth = { jira: "ok", github: "ok", slack: "ok", email: "ok" };

function init(): State {
  const saved = load();
  return {
    base: buildItems(),
    overrides: saved.overrides ?? {},
    log: saved.log ?? [],
    health: saved.health ?? HEALTHY,
    aiFails: saved.aiFails ?? false,
    emptyWorkspace: saved.emptyWorkspace ?? false,
    now: Date.now(),
  };
}

function patch(s: State, id: string, o: Partial<Override>, text?: string): State {
  const overrides = { ...s.overrides, [id]: { ...s.overrides[id], ...o } };
  const log = text ? [{ at: Date.now(), itemId: id, text }, ...s.log].slice(0, 50) : s.log;
  return { ...s, overrides, log };
}

function reducer(s: State, a: Action): State {
  const item = "id" in a ? s.base.find((i) => i.id === a.id) : undefined;
  switch (a.type) {
    case "assign":
      return patch(s, a.id, { assignee: a.to }, `You assigned ${item?.key} to ${a.to ? nameOf(a.to) : "nobody"}`);
    case "done":
      return patch(s, a.id, { done: true, doneAt: Date.now(), snooze: undefined }, `You marked ${item?.key} done`);
    case "reopen":
      return patch(s, a.id, { done: false, doneAt: undefined }, `You reopened ${item?.key}`);
    case "snooze":
      return patch(s, a.id, { snooze: a.snooze }, `You snoozed ${item?.key} until ${a.snooze.label}`);
    case "unsnooze":
      return patch(s, a.id, { snooze: undefined }, `You brought back ${item?.key}`);
    case "health":
      return { ...s, health: { ...s.health, [a.source]: a.ok ? "ok" : "error" } };
    case "aiFails":
      return { ...s, aiFails: a.on };
    case "empty":
      return { ...s, emptyWorkspace: a.on };
    case "tick":
      return { ...s, now: Date.now() };
    case "reset":
      return { ...s, overrides: {}, log: [], health: HEALTHY, aiFails: false, emptyWorkspace: false, base: buildItems(), now: Date.now() };
  }
}

/** Apply the manager's changes on top of the source data. */
function effective(s: State): WorkItem[] {
  if (s.emptyWorkspace) return [];
  return s.base
    .filter((i) => s.health[i.source] === "ok")
    .map((i) => {
      const o = s.overrides[i.id];
      if (!o) return i;
      const next: WorkItem = { ...i };
      if (o.assignee !== undefined) next.assignee = o.assignee;
      if (o.done) { next.status = "done"; next.updatedAt = o.doneAt ?? i.updatedAt; }
      // An item the manager reassigned is no longer "blocked on an owner".
      if (o.assignee && next.blocker?.waitingOn === "unassigned") {
        next.blocker = undefined;
        next.status = next.status === "blocked" ? "todo" : next.status;
      }
      return next;
    });
}

interface Store {
  state: State;
  items: WorkItem[];
  /** Ranked open items that are not snoozed. */
  ranked: Ranked[];
  snoozed: { item: WorkItem; snooze: Snooze }[];
  byId: (id: string) => WorkItem | undefined;
  assign: (id: string, to: string | null) => void;
  markDone: (id: string) => void;
  reopen: (id: string) => void;
  snooze: (id: string, snooze: Snooze) => void;
  unsnooze: (id: string) => void;
  setHealth: (source: Source, ok: boolean) => void;
  setAiFails: (on: boolean) => void;
  setEmpty: (on: boolean) => void;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  useEffect(() => save(state), [state]);
  useEffect(() => {
    const t = setInterval(() => dispatch({ type: "tick" }), 60_000);
    return () => clearInterval(t);
  }, []);

  const items = useMemo(() => effective(state), [state]);

  const { ranked, snoozed } = useMemo(() => {
    const isSnoozed = (id: string) => {
      const sn = state.overrides[id]?.snooze;
      return sn && sn.until > state.now ? sn : undefined;
    };
    const all = rank(items, state.now);
    return {
      ranked: all.filter((r) => !isSnoozed(r.item.id)),
      snoozed: all
        .filter((r) => isSnoozed(r.item.id))
        .map((r) => ({ item: r.item, snooze: isSnoozed(r.item.id)! })),
    };
  }, [items, state.overrides, state.now]);

  const byId = useCallback((id: string) => items.find((i) => i.id === id), [items]);

  const store: Store = {
    state, items, ranked, snoozed, byId,
    assign: (id, to) => dispatch({ type: "assign", id, to }),
    markDone: (id) => dispatch({ type: "done", id }),
    reopen: (id) => dispatch({ type: "reopen", id }),
    snooze: (id, snooze) => dispatch({ type: "snooze", id, snooze }),
    unsnooze: (id) => dispatch({ type: "unsnooze", id }),
    setHealth: (source, ok) => dispatch({ type: "health", source, ok }),
    setAiFails: (on) => dispatch({ type: "aiFails", on }),
    setEmpty: (on) => dispatch({ type: "empty", on }),
    reset: () => dispatch({ type: "reset" }),
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
