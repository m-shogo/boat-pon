// ============================================================
// Small reusable UI bits
// ============================================================

const { useState, useEffect, useMemo, useRef } = React;

// --- Status chip --------------------------------------------
function StatusChip({ s, sm }) {
  const m = {
    BUY:   { c: "buy",    label: "BUY" },
    WATCH: { c: "watch",  label: "WATCH" },
    SKIP:  { c: "skip",   label: "SKIP" },
    PASS:  { c: "buy",    label: "PASS" },
    HIT:   { c: "buy",    label: "HIT" },
    MISS:  { c: "skip",   label: "MISS" },
    SENT:  { c: "info",   label: "SENT" },
    RISK:  { c: "danger", label: "RISK" },
  };
  const v = m[s] || { c: "skip", label: s };
  return (
    <span className={"chip " + v.c} style={sm ? { fontSize: 9, padding: "1px 5px" } : null}>
      <span className="dot"></span>
      {v.label}
    </span>
  );
}

// --- Boat number tile ---------------------------------------
function Boat({ n, sm }) {
  return <span className={"boat" + (sm ? " boat--sm" : "")} data-n={n}>{n}</span>;
}

function BetNums({ bet, sm }) {
  return (
    <span className="bet-line__nums" style={sm ? { fontSize: 13, gap: 3 } : null}>
      {bet.map((n, i) => (
        <React.Fragment key={i}>
          <Boat n={n} sm={sm} />
          {i < bet.length - 1 && <span className="sep">-</span>}
        </React.Fragment>
      ))}
    </span>
  );
}

// --- Countdown timer (mm:ss) --------------------------------
function useCountdown(initMin, initSec, paused) {
  const [t, setT] = useState(initMin * 60 + initSec);
  useEffect(() => { setT(initMin * 60 + initSec); }, [initMin, initSec]);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setT((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(id);
  }, [paused]);
  const mm = Math.floor(t / 60);
  const ss = t % 60;
  return { t, mm, ss, fmt: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` };
}

// --- Odds gauge ----------------------------------------------
function OddsGauge({ req, current, status }) {
  // domain: 0 → max(req*2, current*1.2)
  const max = Math.max(req * 2, (current || req) * 1.2);
  const reqPct = Math.min(100, (req / max) * 100);
  const curPct = current ? Math.min(100, (current / max) * 100) : 0;
  const cls =
    status === "BUY" ? "" :
    status === "WATCH" ? "is-watch" :
    "is-skip";
  return (
    <div className={"odds-gauge " + cls}>
      <div className="odds-gauge__top">
        <span>0倍</span>
        <span className="dim">必要オッズ {req.toFixed(1)} ▼</span>
        <span>{max.toFixed(0)}倍</span>
      </div>
      <div className="odds-gauge__bar">
        {current != null && (
          <div className="odds-gauge__current" style={{ width: curPct + "%" }}></div>
        )}
        <div className="odds-gauge__threshold" style={{ left: reqPct + "%" }}></div>
      </div>
      <div className="odds-gauge__labels">
        <span>取得: {current != null ? <b>{current.toFixed(1)}倍</b> : <span className="dim">未取得</span>}</span>
        <span>{current != null && (
          current >= req
            ? <span style={{color:"var(--buy)"}}>+{(current - req).toFixed(1)} ({((current/req - 1) * 100).toFixed(0)}%)</span>
            : <span style={{color:"var(--danger)"}}>−{(req - current).toFixed(1)}</span>
        )}</span>
      </div>
    </div>
  );
}

// --- KPI tile ------------------------------------------------
function Kpi({ label, value, unit, sub, deltaPos, deltaNeg, bar, barCls, accent }) {
  return (
    <div className="kpi">
      <div className="kpi__head" style={accent ? { color: accent } : null}>
        <span className="dot"></span> {label}
      </div>
      <div className="kpi__value">
        <span className="num">{value}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {(sub || deltaPos || deltaNeg) && (
        <div className="kpi__sub">
          {deltaPos && <span className="delta-pos">▲ {deltaPos}</span>}
          {deltaNeg && <span className="delta-neg">▼ {deltaNeg}</span>}
          {sub && <span>{sub}</span>}
        </div>
      )}
      {bar != null && (
        <div className={"kpi__bar " + (barCls || "")}>
          <div className="fill" style={{ width: Math.min(100, bar) + "%" }}></div>
        </div>
      )}
    </div>
  );
}

// --- Panel ---------------------------------------------------
function Panel({ title, code, meta, pulse, children, body = true, bracketed = true, className }) {
  return (
    <div className={"panel" + (bracketed ? " bracketed" : "") + (className ? " " + className : "")}>
      {(title || code) && (
        <div className="panel__head">
          <span className="corner">┌</span>
          {code && <span className="corner">[{code}]</span>}
          <span className="title">{title}</span>
          <span className="spacer"></span>
          {pulse && <span className="pulse" title="live"></span>}
          {meta && <span className="meta">{meta}</span>}
        </div>
      )}
      {body ? <div className="panel__body">{children}</div> : children}
    </div>
  );
}

// --- Race card -----------------------------------------------
function RaceCard({ race, onOpen, compact }) {
  const cd = useCountdown(race.closeMin, race.closeSec);
  const near = cd.t <= 600 && cd.t > 300;
  const imm  = cd.t <= 300;
  const statusCls = race.status === "BUY" ? "is-buy" : race.status === "WATCH" ? "is-watch" : "is-skip";

  return (
    <div className={"racecard " + statusCls} onClick={() => onOpen?.(race)}>
      <div className="racecard__head">
        <span className="racecard__venue">{race.venueName}</span>
        <span className="racecard__race">{race.raceNo}R · {race.betType}</span>
        <span className={"racecard__close" + (imm ? " is-imminent" : near ? " is-near" : "")}>
          締切 <span className="countdown num">{cd.fmt}</span> <span className="dim">({race.closeAt})</span>
        </span>
      </div>
      <div className="racecard__body">
        <div className="row" style={{ marginBottom: 10 }}>
          <StatusChip s={race.status} />
          {race.suggestedAmount > 0 && <span className="chip info"><span className="dot"></span>推奨 ¥{race.suggestedAmount}</span>}
          {!race.samplesEnough && <span className="chip skip">サンプル不足</span>}
          {race.curOdds == null && <span className="chip skip">オッズ未取得</span>}
          <span className="tag">{race.bet.join("-")}</span>
        </div>

        <div className="bet-line">
          <span className="bet-line__label">買い目</span>
          <BetNums bet={race.bet} />
          <span className="bet-line__type">{race.betType}</span>
        </div>

        <div className="metric-row">
          <div className="metric-row__cell">
            <div className="l">推定的中率</div>
            <div className="v">{(race.pHat * 100).toFixed(1)}<span className="u">%</span></div>
          </div>
          <div className="metric-row__cell">
            <div className="l">必要オッズ</div>
            <div className="v">{race.reqOdds.toFixed(1)}<span className="u">倍</span></div>
          </div>
          <div className="metric-row__cell">
            <div className="l">現在オッズ</div>
            <div className="v">{race.curOdds != null ? <>{race.curOdds.toFixed(1)}<span className="u">倍</span></> : <span className="dim">—</span>}</div>
          </div>
          <div className={"metric-row__cell " + (race.ev >= 1.25 ? "is-good" : race.ev != null && race.ev < 1.05 ? "is-bad" : "")}>
            <div className="l">EV</div>
            <div className="v">{race.ev != null ? race.ev.toFixed(3) : <span className="dim">—</span>}</div>
          </div>
        </div>

        {!compact && <OddsGauge req={race.reqOdds} current={race.curOdds} status={race.status} />}

        {race.notes && (
          <div className="dim" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.6 }}>
            ※ {race.notes}
          </div>
        )}
      </div>
      <div className="racecard__foot">
        {race.status === "BUY" ? (
          <>
            <span className="amount">推奨 <b>¥{race.suggestedAmount}</b> · 1点のみ</span>
            <span className="spacer flex--1"></span>
            <a
              href="https://www.boatrace.jp/owpc/pc/race/odds3t"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--primary btn--xs"
              onClick={(e) => e.stopPropagation()}
            >
              公式で確認して購入 <span className="ext"></span>
            </a>
          </>
        ) : (
          <>
            <span className="amount dim">記録のみ · 購入対象外</span>
            <span className="spacer flex--1"></span>
            <button className="btn btn--ghost btn--xs" onClick={(e) => { e.stopPropagation(); onOpen?.(race); }}>
              詳細 →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --- Tiny sparkline ------------------------------------------
function Spark({ data, w = 80, h = 20, color = "var(--muted)" }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx={w} cy={h - ((data[data.length-1] - min) / range) * h} r="2" fill={color} />
    </svg>
  );
}

// --- Toggle + Seg controls -----------------------------------
function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? "is-active" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange }) {
  return <div className={"toggle " + (on ? "is-on" : "")} onClick={() => onChange(!on)}></div>;
}

// --- ASCII title divider --------------------------------------
function AsciiBox({ children, label }) {
  return (
    <pre className="ascii dim" style={{ margin: 0, fontSize: 10, lineHeight: 1.1 }}>
      {`┌─ ${label} `}{"─".repeat(Math.max(4, 40 - label.length))}{`┐\n`}
      {children}
      {`\n└${"─".repeat(45)}┘`}
    </pre>
  );
}

// Expose all to window for cross-file React usage
Object.assign(window, {
  StatusChip, Boat, BetNums, useCountdown, OddsGauge, Kpi, Panel,
  RaceCard, Spark, Seg, Toggle, AsciiBox,
});
