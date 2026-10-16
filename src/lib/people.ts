import { ME, TEAM } from "../data/mock";
import type { Person } from "../types";

const byId = new Map<string, Person>([...TEAM, ME].map((p) => [p.id, p]));

export function person(id: string | null | undefined): Person | undefined {
  return id ? byId.get(id) : undefined;
}

/** Display name for a person id, or the raw string for people outside the team. */
export function nameOf(id: string | null | undefined): string {
  if (!id) return "Unassigned";
  if (id === "me") return "You";
  return byId.get(id)?.name ?? id;
}

export function firstName(id: string | null | undefined): string {
  if (id === "me") return "you";
  return nameOf(id).split(" ")[0];
}
