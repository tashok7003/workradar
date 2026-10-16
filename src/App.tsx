import { useEffect, useState } from "react";
import { Icon, RadarMark } from "./components/Icon";
import { Avatar, Banner, Popover, SOURCE_LABEL, ToastProvider } from "./components/ui";
import { ME } from "./data/mock";
import { Dashboard } from "./pages/Dashboard";
import { Feed } from "./pages/Feed";
import { ItemDetail } from "./pages/ItemDetail";
import { Search } from "./pages/Search";
import { RouterProvider, useRouter } from "./router";
import { StoreProvider, useStore } from "./store";
import type { Source } from "./types";

const SOURCES: Source[] = ["jira", "github", "slack", "email"];

function Shell() {
  const { route, go } = useRouter();
  const { ranked, snoozed, state, setHealth, setAiFails, setEmpty, reset } = useStore();
  const [retrying, setRetrying] = useState<Source | null>(null);
  const nowCount = ranked.filter((r) => r.tier === "now").length;
  const down = SOURCES.filter((s) => state.health[s] === "error");

  // "/" jumps to search from anywhere, as in most work tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName)) { e.preventDefault(); go({ name: "search" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const retry = (s: Source) => {
    setRetrying(s);
    // Mock reconnect: a real build would re-run the source sync here.
    setTimeout(() => { setHealth(s, true); setRetrying(null); }, 1200);
  };

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: "home", on: route.name === "dashboard", go: () => go({ name: "dashboard" }) },
    { id: "feed", label: "Priority feed", icon: "feed", on: route.name === "feed" && route.tab !== "snoozed", go: () => go({ name: "feed", tab: "now" }), n: nowCount },
    { id: "search", label: "Search", icon: "search", on: route.name === "search", go: () => go({ name: "search" }), kbd: "/" },
    { id: "snoozed", label: "Snoozed", icon: "snooze", on: route.name === "feed" && route.tab === "snoozed", go: () => go({ name: "feed", tab: "snoozed" }), n: snoozed.length || undefined },
  ];

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <RadarMark />
          <span>WorkRadar</span>
        </div>

        <nav className="nav" aria-label="Main">
          {nav.map((n) => (
            <button key={n.id} className={`nav-item${n.on ? " is-on" : ""}`} onClick={n.go} aria-current={n.on ? "page" : undefined}>
              <Icon name={n.icon} size={18} />
              <span className="nav-label">{n.label}</span>
              {n.n ? <span className="nav-n">{n.n}</span> : n.kbd ? <kbd>{n.kbd}</kbd> : null}
            </button>
          ))}
        </nav>

        <section className="sources" aria-label="Connected sources">
          <h2>Sources</h2>
          <ul>
            {SOURCES.map((s) => (
              <li key={s} className={state.health[s] === "error" ? "is-down" : ""}>
                <span className={`dot dot-${state.health[s] === "error" ? "error" : "ok"}`} />
                <span>{SOURCE_LABEL[s]}</span>
                <span className="src-state">{retrying === s ? "Syncing…" : state.health[s] === "error" ? "Sync failed" : "Mock data"}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="rail-foot">
          <Popover
            align="start"
            trigger={(toggle, open) => (
              <button className="btn btn-quiet btn-sm demo-btn" onClick={toggle} aria-expanded={open}>
                <Icon name="sliders" size={14} /> <span>Demo controls</span>
              </button>
            )}
          >
            {() => (
              <div className="demo">
                <div className="pop-title">Simulate states for review</div>
                {SOURCES.map((s) => (
                  <label key={s} className="toggle">
                    <input id={`demo-${s}`} type="checkbox" checked={state.health[s] === "error"} onChange={(e) => setHealth(s, !e.target.checked)} />
                    {SOURCE_LABEL[s]} sync fails
                  </label>
                ))}
                <label className="toggle">
                  <input id="demo-ai" type="checkbox" checked={state.aiFails} onChange={(e) => setAiFails(e.target.checked)} />
                  AI request fails
                </label>
                <label className="toggle">
                  <input id="demo-empty" type="checkbox" checked={state.emptyWorkspace} onChange={(e) => setEmpty(e.target.checked)} />
                  Empty workspace
                </label>
                <button className="pop-item pop-item-muted" onClick={reset}>Reset demo data</button>
              </div>
            )}
          </Popover>
          <div className="me">
            <Avatar id="me" size={28} />
            <span><strong>{ME.name}</strong><small>{ME.role}</small></span>
          </div>
        </div>
      </aside>

      <main className="main">
        {down.length > 0 && (
          <div className="banners">
            {down.map((s) => (
              <Banner
                key={s}
                tone="error"
                title={`${SOURCE_LABEL[s]} didn't sync`}
                action={<button className="btn btn-quiet btn-sm" onClick={() => retry(s)} disabled={retrying === s}><Icon name="refresh" size={14} /> {retrying === s ? "Retrying…" : "Retry"}</button>}
              >
                Items from {SOURCE_LABEL[s]} are missing from the feed, briefing and search until it reconnects.
              </Banner>
            ))}
          </div>
        )}
        {route.name === "dashboard" && <Dashboard />}
        {route.name === "feed" && <Feed tab={route.tab} />}
        {route.name === "item" && <ItemDetail id={route.id} />}
        {route.name === "search" && <Search initial={route.q} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <RouterProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </RouterProvider>
    </StoreProvider>
  );
}
