// ============================================================
// Boat EV Notifier — main app shell
// ============================================================

const { useState: useS, useEffect: useE } = React;

const NAV = [
  { id: "dash",    n: "01", label: "ダッシュボード",  short: "DASH" },
  { id: "buy",     n: "02", label: "候補レース",      short: "CAND" },
  { id: "history", n: "03", label: "判定履歴 / 検証", short: "LOG"  },
  { id: "notif",   n: "04", label: "通知センター",    short: "NOTIF"},
  { id: "settings",n: "05", label: "設定 / 安全装置", short: "CONF" },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "mode": "buy",
  "theme": "dark",
  "density": "dense",
  "targetEV": 1.25,
  "budget": 1000
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useS({ screen: "dash", race: null });

  useE(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.setAttribute("data-density", t.density);
  }, [t.theme, t.density]);

  const settings = {
    targetEV: t.targetEV,
    budget: t.budget,
    theme: t.theme,
    density: t.density,
  };

  const openRace = (r) => setView({ screen: "detail", race: r });
  const goNav = (id) => setView({ screen: id, race: null });

  const races = t.mode === "buy" ? window.BoatData.RACES_BUY_DAY : window.BoatData.RACES_QUIET_DAY;
  const buyN = races.filter(r => r.status === "BUY").length;

  return (
    <div className="app">
      <Header mode={t.mode} buyN={buyN} settings={settings} />
      <Sidebar current={view.screen} onNav={goNav} buyN={buyN} mode={t.mode} settings={settings} />
      <main className="main" data-screen-label={NAV.find(n => n.id === view.screen)?.label || "screen"}>
        <PageHead view={view} settings={settings} mode={t.mode} />
        {view.screen === "dash"     && <ScreenDashboard mode={t.mode} settings={settings} onOpen={openRace} onNav={goNav} />}
        {view.screen === "buy"      && <ScreenBuyList   mode={t.mode} settings={settings} onOpen={openRace} />}
        {view.screen === "detail"   && <ScreenDetail    race={view.race} onBack={() => setView({ screen: "buy" })} />}
        {view.screen === "history"  && <ScreenHistory />}
        {view.screen === "notif"    && <ScreenNotif     mode={t.mode} />}
        {view.screen === "settings" && <ScreenSettings  settings={t} onChange={(s) => setTweak(s)} />}
      </main>
      <MobileNav current={view.screen} onNav={goNav} buyN={buyN} />

      <TweaksPanel title="Tweaks" defaultOpen={false}>
        <TweakSection title="デモ状態">
          <TweakRadio
            value={t.mode}
            onChange={(v) => setTweak("mode", v)}
            options={[
              { value: "quiet", label: "見送り日" },
              { value: "buy",   label: "BUY候補日" },
            ]}
          />
        </TweakSection>
        <TweakSection title="判定パラメータ">
          <TweakRadio
            value={t.targetEV}
            onChange={(v) => setTweak("targetEV", v)}
            options={[
              { value: 1.20, label: "1.20" },
              { value: 1.25, label: "1.25" },
              { value: 1.30, label: "1.30" },
            ]}
            label="目標EV"
          />
          <TweakRadio
            value={t.budget}
            onChange={(v) => setTweak("budget", v)}
            options={[
              { value: 500,  label: "¥500" },
              { value: 1000, label: "¥1k" },
              { value: 2000, label: "¥2k" },
            ]}
            label="1日予算"
          />
        </TweakSection>
        <TweakSection title="表示">
          <TweakRadio
            value={t.theme}
            onChange={(v) => setTweak("theme", v)}
            options={[
              { value: "dark",  label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            label="カラーモード"
          />
          <TweakRadio
            value={t.density}
            onChange={(v) => setTweak("density", v)}
            options={[
              { value: "dense", label: "密" },
              { value: "loose", label: "ゆったり" },
            ]}
            label="情報密度"
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// ---- Header (top bar) -----------------------------------
function Header({ mode, buyN, settings }) {
  const [now, setNow] = useS(new Date());
  useE(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <header className="header">
      <div className="header__logo">
        <span className="mark">⚓</span>
        <span>Boat EV Notifier</span>
        <span className="ver">v0.3.1-mvp</span>
      </div>
      <div className="header__ticker">
        <span className="item"><b>SESSION</b><span className="pos">● live</span></span>
        <span className="item"><b>MODE</b>{mode === "buy" ? "BUY-detected" : "PASS"}</span>
        <span className="item"><b>EV≥</b>{settings.targetEV.toFixed(2)}</span>
        <span className="item"><b>BUDGET</b>¥{settings.budget}</span>
        <span className="item"><b>CAND</b>{buyN}</span>
        <span className="item"><b>FETCH</b>kyotei24 · low-freq</span>
      </div>
      <div className="header__time">
        <b>{time}</b> JST · 2026-05-21
      </div>
      <button className="header__sysbtn"><span className="dot"></span>SYS OK</button>
    </header>
  );
}

// ---- Sidebar (desktop nav) ------------------------------
function Sidebar({ current, onNav, buyN, mode, settings }) {
  const races = mode === "buy" ? window.BoatData.RACES_BUY_DAY : window.BoatData.RACES_QUIET_DAY;
  const watchN = races.filter(r => r.status === "WATCH").length;
  const skipN = races.filter(r => r.status === "SKIP").length;
  const usedAmt = races.filter(r => r.status === "BUY").reduce((s, r) => s + (r.suggestedAmount || 0), 0);

  return (
    <aside className="sidebar">
      <div className="sidebar__group">
        <div className="sidebar__label">SCREENS</div>
        <div className="nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={"nav__item" + (current === n.id || (n.id === "buy" && current === "detail") ? " is-active" : "")}
              onClick={() => onNav(n.id)}>
              <span className="num">{n.n}</span>
              <span className="label">{n.label}</span>
              {n.id === "buy" && buyN > 0 && <span className="badge">{buyN}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar__group">
        <div className="sidebar__label">TODAY</div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>判定</span>
            <span style={{ color: mode === "buy" ? "var(--watch-2)" : "var(--buy-2)" }}>
              {mode === "buy" ? "BUY×" + buyN : "PASS"}
            </span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>BUY</span>
            <span style={{ color: "var(--buy)" }} className="num">{buyN}</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>WATCH</span>
            <span style={{ color: "var(--watch)" }} className="num">{watchN}</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>SKIP</span>
            <span style={{ color: "var(--skip-2)" }} className="num">{skipN}</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
            <span>使用予定</span>
            <span className="bright num">¥{usedAmt}</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>予算</span>
            <span className="dim num">¥{settings.budget}</span>
          </div>
        </div>
      </div>

      <div className="sidebar__footer">
        <b>DATA SOURCES</b><br />
        · BOAT RACE 公式 (DL)<br />
        · kyotei24.jp (候補のみ)<br />
        · ローカル SQLite<br />
        <span className="warn">⚠ 自動購入は実装なし</span>
      </div>
    </aside>
  );
}

// ---- Mobile bottom nav ----------------------------------
function MobileNav({ current, onNav, buyN }) {
  return (
    <nav className="mobile-nav">
      {NAV.map(n => (
        <button
          key={n.id}
          className={"nav__item" + (current === n.id || (n.id === "buy" && current === "detail") ? " is-active" : "")}
          onClick={() => onNav(n.id)}>
          <span className="label">{n.short}</span>
          {n.id === "buy" && buyN > 0 && <span className="badge" style={{ fontSize: 9 }}>{buyN}</span>}
        </button>
      ))}
    </nav>
  );
}

// ---- Page head ------------------------------------------
function PageHead({ view, settings, mode }) {
  const titles = {
    dash:     ["DASHBOARD",  "本日の判定 (2026-05-21)"],
    buy:      ["CANDIDATES", "候補レース一覧"],
    detail:   ["RACE DETAIL", "レース詳細"],
    history:  ["BACKTEST",   "判定履歴 / バックテスト"],
    notif:    ["NOTIF",      "通知センター"],
    settings: ["CONFIG",     "設定 / 安全装置"],
  };
  const [code, t] = titles[view.screen] || ["", ""];
  return (
    <div className="page__head">
      <h1>
        <span className="brk">[</span>
        <span style={{ color: "var(--buy)", fontSize: 14, fontWeight: 500 }}>{code}</span>
        <span className="brk">]</span>
        <span>{t}</span>
      </h1>
      <span className="spacer flex--1"></span>
      <span className="meta">
        EV target: <b>{settings.targetEV.toFixed(2)}</b> · 予算: <b>¥{settings.budget}</b> · モード: <b>{mode === "buy" ? "BUY-day" : "PASS-day"}</b>
      </span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
