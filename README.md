# WorkRadar

One screen that tells an engineering manager what needs them now, what their team is working on today, who is blocked, and what already happened, without opening Jira, GitHub, Slack and email separately.

This is the working MVP for the WorkRadar case study. It runs on mock data for a seven-person Payments team. No real integrations are connected.

## Run it

Requires Node 18 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

That's all you need. The AI briefing falls back to a rules-based summary when no model is connected, and the UI labels it as such.

### With live AI (optional)

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
# optional: ANTHROPIC_MODEL=claude-haiku-5-5 (default claude-sonnet-5-5)
```

The key stays in the Vite dev server. The browser calls `/api/claude`, and the dev proxy forwards it to the Anthropic Messages API with the key attached, so the key never reaches the client bundle.

### Live on GitHub Pages

Every push to `main` runs the tests, builds the app and deploys it to GitHub Pages (`.github/workflows/deploy.yml`). The Pages build has no model connected, so its briefing is the labelled rules-based version.

### Hosted demo inside Claude

The same build is published as a claude.ai Artifact. When opened there, the briefing and the "Draft a reply / nudge" button run on Claude through the viewer's own Claude account (the page asks once for permission).

### Other scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests for ranking, search and AI-output validation (Vitest) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run build:single` | Build one self-contained HTML file for the hosted demo (`dist-single/workradar.html`) |

## What's in it

| Screen | What you can do |
|---|---|
| Dashboard | Four answers at a glance (need you now, blocked, top work today, done today), the AI briefing with clickable citations, top items, who's blocked, today's timeline |
| Priority feed | Tabs for Now / Today / Later / All / Snoozed, filter by source and owner, score on every row |
| Item detail | Blocker, "why it's ranked here" score breakdown, AI-drafted reply or nudge, activity, related items |
| Search | Keyword search across every source, people, labels and activity, with highlighting and source filters |
| Empty and error states | Per-tab empty states, no-results, source sync failure banner with retry, AI failure fallback, empty workspace |

Actions on any item: **Assign**, **Snooze** (1h, 3h, tomorrow 9:00, next Monday 9:00) and **Mark done**, each with Undo. State persists in `localStorage`. **Demo controls** (bottom of the sidebar) simulate a source outage, an AI failure and an empty workspace, and reset the data.

Keyboard: `/` opens search.

## How it works

```
mock sources ─► store (overrides: assign, done, snooze) ─► rank() ─► UI
                                                         └─► briefing context ─► Claude ─► validate ─► UI
                                                                                └─► rules-based fallback
```

- **Ranking is deterministic** (`src/lib/priority.ts`). Each item gets points for severity, blockers (work blocked on the manager scores highest), due dates, customer impact, security, stale reviews, missing owners, and links to an active incident. Score ≥ 55 is *Now*, 32–54 is *Today*, the rest is *Later*. Every point is shown to the user as a reason chip.
- **AI explains, it doesn't rank** (`src/lib/ai.ts`). Claude gets the already-ranked items as compact JSON and writes the briefing as JSON. Every item it cites is checked against the data, and unknown ids are dropped. If the call fails or the reply is malformed, the rules-based briefing is shown with a notice.
- **Routing** is in-memory so the app also works inside the sandboxed Artifact frame.

## Project layout

```
src/
  data/mock.ts          team and 27 work items, timestamps relative to load time
  lib/priority.ts       scoring rules and tiers
  lib/ai.ts             providers, prompts, output validation, rules-based fallback
  lib/search.ts         weighted multi-field search and highlighting
  store.tsx             state, actions, persistence
  pages/                Dashboard, Feed, ItemDetail, Search
  components/           Briefing, ItemRow, shared UI
```

## Where AI was used

See `docs/WorkRadar_AI_Workflow.pdf` for the full record: tools, prompts, what was generated, what changed after review, and trade-offs. The PRD is `docs/WorkRadar_PRD.pdf`; both are rendered from the HTML sources beside them.
