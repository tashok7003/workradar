import type { Ranked, WorkItem } from "../types";
import { firstName, nameOf } from "./people";
import { isToday, span, dueLabel } from "./time";

/**
 * AI layer.
 *
 * Three providers, tried in order:
 *  1. Claude through the claude.ai Artifact runtime (`sample`), when the app is
 *     opened as a published artifact. Runs on the viewer's own Claude account.
 *  2. Claude through the Anthropic Messages API, via the Vite dev proxy, when
 *     the dev server was started with ANTHROPIC_API_KEY.
 *  3. A local rules-based writer, so the app always shows a briefing even with
 *     no model available. The UI labels it as rules-based, never as AI.
 *
 * Whatever the model returns is validated: every item it cites must exist in
 * the data it was given, or the citation is dropped.
 */

declare const __LIVE_PROXY__: boolean;
declare const __AI_MODEL__: string;

export interface Line { text: string; ids: string[] }
export interface Briefing {
  headline: string;
  attention: Line[];
  blocked: Line[];
  happened: Line[];
  suggestion: Line;
}

export type ProviderId = "claude-artifact" | "claude-api" | "offline";
export interface ProviderInfo { id: ProviderId; label: string }

type SampleFn = ((input: string, opts?: object) => Promise<{ text: string }>) & {
  json: <T>(input: string, opts?: object) => Promise<T>;
};

let samplePromise: Promise<SampleFn | null> | null = null;
function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const c = (globalThis as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    samplePromise = c?.use ? (c.use("sample") as Promise<SampleFn | null>).catch(() => null) : Promise.resolve(null);
  }
  return samplePromise;
}

export async function detectProvider(): Promise<ProviderInfo> {
  if (await getSample()) return { id: "claude-artifact", label: "Claude" };
  if (typeof __LIVE_PROXY__ !== "undefined" && __LIVE_PROXY__) return { id: "claude-api", label: `Claude (${__AI_MODEL__})` };
  return { id: "offline", label: "Rules-based summary" };
}

export class AiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function askJson<T>(provider: ProviderId, prompt: string, signal?: AbortSignal, fresh = false): Promise<T> {
  if (provider === "claude-artifact") {
    const sample = await getSample();
    if (!sample) throw new AiError("unavailable", "Claude isn't available in this view.");
    try {
      return await sample.json<T>(prompt, { signal, cache: { gcTime: 10 * 60_000, refresh: fresh } });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      throw new AiError(err.code ?? "upstream_error", err.message ?? "Claude request failed");
    }
  }
  if (provider === "claude-api") {
    const res = await fetch("/api/claude", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: __AI_MODEL__,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new AiError(`http_${res.status}`, `Anthropic API returned ${res.status}`);
    const data = await res.json();
    const text: string = data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    return parseJson<T>(text);
  }
  throw new AiError("offline", "No model configured");
}

async function askText(provider: ProviderId, prompt: string, signal?: AbortSignal): Promise<string> {
  if (provider === "claude-artifact") {
    const sample = await getSample();
    if (!sample) throw new AiError("unavailable", "Claude isn't available in this view.");
    try {
      return (await sample(prompt, { signal, modelTier: "quick" })).text.trim();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      throw new AiError(err.code ?? "upstream_error", err.message ?? "Claude request failed");
    }
  }
  if (provider === "claude-api") {
    const res = await fetch("/api/claude", {
      method: "POST", signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: __AI_MODEL__, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new AiError(`http_${res.status}`, `Anthropic API returned ${res.status}`);
    const data = await res.json();
    return (data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "").trim();
  }
  throw new AiError("offline", "No model configured");
}

export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new AiError("invalid_json", "The model's reply was not valid JSON");
  }
}

// ---------------------------------------------------------------------------
// Context sent to the model: compact, factual, already ranked.
// ---------------------------------------------------------------------------

export function buildContext(ranked: Ranked[], items: WorkItem[], now = Date.now()) {
  const open = ranked.slice(0, 18).map((r) => ({
    id: r.item.id,
    key: r.item.key,
    source: r.item.source,
    title: r.item.title,
    status: r.item.status,
    owner: r.item.assignee ? nameOf(r.item.assignee) : "unassigned",
    priority: r.tier,
    why: r.reasons.map((x) => x.label),
    blocker: r.item.blocker
      ? { reason: r.item.blocker.reason, waitingOn: nameOf(r.item.blocker.waitingOn), for: span(r.item.blocker.since, now) }
      : undefined,
    due: r.item.dueAt ? dueLabel(r.item.dueAt, now) : undefined,
    detail: r.item.body.slice(0, 280),
  }));
  const doneToday = items
    .filter((i) => i.status === "done" && isToday(i.updatedAt, now))
    .map((i) => ({ id: i.id, key: i.key, title: i.title, by: nameOf(i.assignee), when: span(i.updatedAt, now) + " ago" }));
  return { manager: "Ashok (engineering manager, Payments Platform)", openItems: open, finishedToday: doneToday };
}

export function briefingPrompt(ctx: ReturnType<typeof buildContext>): string {
  return [
    "You are WorkRadar, a chief-of-staff assistant for an engineering manager.",
    "Write today's briefing from the work items below. They come from Jira, GitHub, Slack and email and are already ranked by urgency (priority: now > today > later).",
    "",
    "Rules:",
    "- Use only facts in the data. Do not invent people, numbers, times or causes.",
    "- Address the manager as \"you\". Plain, specific sentences. No filler, no exclamation marks.",
    "- Each line is one sentence, at most 24 words, and names the concrete next step where there is one.",
    "- Cite the item ids each line is about in its \"ids\" array, using only ids from the data.",
    "- When several items are one situation (an incident, its PR, a customer email), cover them in one line.",
    "- \"blocked\": who is blocked, on what, for how long. Lead with anything blocked on the manager (waitingOn \"You\").",
    "",
    "Reply with only this JSON:",
    '{"headline": "one sentence on the state of the day",',
    ' "attention": [{"text": "...", "ids": ["..."]}],   // 2-3 lines, most urgent first',
    ' "blocked": [{"text": "...", "ids": ["..."]}],     // up to 4 lines',
    ' "happened": [{"text": "...", "ids": ["..."]}],    // up to 3 lines from finishedToday',
    ' "suggestion": {"text": "the single best thing to do in the next 30 minutes", "ids": ["..."]}}',
    "",
    "DATA:",
    JSON.stringify(ctx),
  ].join("\n");
}

function cleanLine(l: unknown, known: Set<string>): Line | null {
  if (!l || typeof l !== "object") return null;
  const o = l as { text?: unknown; ids?: unknown };
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) return null;
  const ids = Array.isArray(o.ids) ? o.ids.map(String).filter((id) => known.has(id)) : [];
  return { text, ids: [...new Set(ids)] };
}

/** Drop anything malformed and any citation to an item that isn't in the data. */
export function validateBriefing(raw: unknown, items: WorkItem[]): Briefing {
  const known = new Set(items.map((i) => i.id));
  const r = (raw ?? {}) as Record<string, unknown>;
  const lines = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).map((l) => cleanLine(l, known)).filter((l): l is Line => !!l).slice(0, max);
  const headline = typeof r.headline === "string" ? r.headline.trim() : "";
  const suggestion = cleanLine(r.suggestion, known);
  if (!headline || !suggestion) throw new AiError("invalid_shape", "The model's reply was missing required fields");
  return {
    headline,
    attention: lines(r.attention, 3),
    blocked: lines(r.blocked, 4),
    happened: lines(r.happened, 3),
    suggestion,
  };
}

export async function generateBriefing(
  provider: ProviderId, ranked: Ranked[], items: WorkItem[], opts: { signal?: AbortSignal; forceFail?: boolean; fresh?: boolean } = {},
): Promise<Briefing> {
  if (opts.forceFail) {
    await new Promise((r) => setTimeout(r, 900));
    throw new AiError("upstream_error", "Simulated failure (demo setting)");
  }
  if (provider === "offline") return offlineBriefing(ranked, items);
  const ctx = buildContext(ranked, items);
  const raw = await askJson<unknown>(provider, briefingPrompt(ctx), opts.signal, opts.fresh);
  return validateBriefing(raw, items);
}

// ---------------------------------------------------------------------------
// Rules-based fallback writer. Same shape, deterministic, clearly labelled.
// ---------------------------------------------------------------------------

export function offlineBriefing(ranked: Ranked[], items: WorkItem[], now = Date.now()): Briefing {
  const nowTier = ranked.filter((r) => r.tier === "now");
  const blockedItems = ranked.filter((r) => r.item.blocker);
  const onMe = blockedItems.filter((r) => r.item.blocker!.waitingOn === "me");
  const done = items.filter((i) => i.status === "done" && isToday(i.updatedAt, now));

  if (!ranked.length) {
    return {
      headline: "Nothing is open across your sources. Your team has no blocked or urgent work.",
      attention: [], blocked: [],
      happened: done.slice(0, 3).map((i) => ({ text: `${nameOf(i.assignee)} finished ${i.key}: ${i.title}.`, ids: [i.id] })),
      suggestion: { text: "Use the time for planning or 1:1s; WorkRadar will flag anything new.", ids: [] },
    };
  }

  const headline =
    `${nowTier.length} item${nowTier.length === 1 ? "" : "s"} need${nowTier.length === 1 ? "s" : ""} you now, ` +
    `${blockedItems.length} piece${blockedItems.length === 1 ? " of work is" : "s of work are"} blocked` +
    (onMe.length ? ` (${onMe.length} on you)` : "") +
    `, and ${done.length} thing${done.length === 1 ? "" : "s"} shipped or closed today.`;

  const why = (labels: string[]) => labels.map((l) => (/^P\d$/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1))).join(", ");
  const attention = nowTier.slice(0, 3).map((r) => ({
    text: `${r.item.kind === "ticket" || r.item.kind === "pr" ? r.item.key + ": " : ""}${r.item.title} (${why(r.reasons.slice(0, 2).map((x) => x.label))}).`,
    ids: [r.item.id],
  }));

  const blocked = [...onMe, ...blockedItems.filter((r) => r.item.blocker!.waitingOn !== "me")].slice(0, 4).map((r) => {
    const b = r.item.blocker!;
    const who = r.item.assignee ?? r.item.author;
    const on = b.waitingOn === "me" ? "you" : b.waitingOn === "unassigned" ? "an owner" : nameOf(b.waitingOn);
    // The reason already names the other party, so "on whom" only leads when it's the manager.
    const lead = on === "you" ? `${nameOf(who)} has waited ${span(b.since, now)} on you for` : `${nameOf(who)} has waited ${span(b.since, now)} for`;
    return { text: `${lead} ${b.reason}.`, ids: [r.item.id] };
  });

  const happened = done
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3)
    .map((i) => ({ text: `${firstName(i.assignee)} ${i.kind === "pr" ? "merged" : i.kind === "deploy" ? "shipped" : "closed"} ${i.key}: ${i.title}.`, ids: [i.id] }));

  const top = onMe[0] ?? nowTier[0] ?? ranked[0];
  const suggestion = {
    text: top.item.blocker?.waitingOn === "me"
      ? `Unblock ${firstName(top.item.assignee ?? top.item.author)} first. ${top.item.key} needs ${top.item.blocker.reason}.`
      : `Start with ${top.item.title}.`,
    ids: [top.item.id],
  };

  return { headline, attention, blocked, happened, suggestion };
}

// ---------------------------------------------------------------------------
// Per-item helper: draft a short nudge message.
// ---------------------------------------------------------------------------

export function wantsReply(item: WorkItem): boolean {
  return !!item.needsReplyFromMe && item.blocker?.waitingOn !== "unassigned";
}

export function nudgePrompt(item: WorkItem): string {
  const b = item.blocker;
  const task = wantsReply(item)
    ? `Draft Ashok's reply to ${nameOf(item.author)} (${item.source === "email" ? "an email" : "a Slack message"}, 2-4 sentences, plain and direct, no emoji). Acknowledge the ask and commit to a concrete next step. Do not promise dates or facts that are not in the data; where a fact is unknown, say Ashok will confirm it and when.`
    : "Draft a short Slack message (2-3 sentences, friendly and direct, no emoji) that an engineering manager named Ashok could send to move this work forward.";
  return [
    task,
    "Use only the facts below. Name the specific ask and a time. Reply with the message text only.",
    "",
    JSON.stringify({
      key: item.key, title: item.title, detail: item.body,
      owner: nameOf(item.assignee), author: nameOf(item.author),
      blocker: b ? { reason: b.reason, waitingOn: nameOf(b.waitingOn), for: span(b.since) } : null,
      due: item.dueAt ? dueLabel(item.dueAt) : null,
    }),
  ].join("\n");
}

export function offlineNudge(item: WorkItem): string {
  const b = item.blocker;
  if (wantsReply(item)) {
    const to = firstName(item.author);
    const when = item.dueAt ? (item.dueAt < Date.now() ? "today" : `within the next ${dueLabel(item.dueAt).replace("Due in ", "")}`) : "today";
    return `Hi ${to}, thanks for flagging this. I'm on it and will get back to you with a clear answer ${when}.`;
  }
  if (b && b.waitingOn !== "me" && b.waitingOn !== "unassigned") {
    return `Hi ${firstName(b.waitingOn)}, ${item.key} (${item.title}) has been waiting ${span(b.since)} for ${b.reason}. Could you take a look today, or tell me who else can?`;
  }
  if (b?.waitingOn === "unassigned") {
    return `Team, ${item.title.charAt(0).toLowerCase() + item.title.slice(1)}. We need ${b.reason}. Who can pick this up in the next hour?`;
  }
  const owner = item.assignee ? firstName(item.assignee) : "team";
  return `Hi ${owner}, checking on ${item.key} (${item.title}). What's left, and is anything in your way${item.dueAt ? ` before it's ${dueLabel(item.dueAt).toLowerCase()}` : ""}?`;
}

export async function draftNudge(provider: ProviderId, item: WorkItem, forceFail = false): Promise<string> {
  if (forceFail) throw new AiError("upstream_error", "Simulated failure (demo setting)");
  if (provider === "offline") return offlineNudge(item);
  return askText(provider, nudgePrompt(item));
}
