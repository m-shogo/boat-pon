// ============================================================
// Dashboard + BUY list + Race detail screens
// ============================================================

// Use window.BoatData directly to avoid top-level identifier clashes
// between sibling <script type="text/babel"> files.
const _BD = window.BoatData;

// =============================================================
// DASHBOARD
// =============================================================
function ScreenDashboard({ mode, settings, onOpen, onNav }) {
  const RACES_BUY_DAY = _BD.RACES_BUY_DAY;
  const RACES_QUIET_DAY = _BD.RACES_QUIET_DAY;
  const EV_BUCKETS = _BD.EV_BUCKETS;
  const ACTIVITY = _BD.ACTIVITY;
  const races = mode === "buy" ? RACES_BUY_DAY : RACES_QUIET_DAY;
  const buyCount = races.filter(r => r.status === "BUY").length;
  const watchCount = races.filter(r => r.status === "WATCH").length;
  const skipCount = races.filter(r => r.status === "SKIP").length;

  const usedAmount = races
    .filter(r => r.status === "BUY")
    .reduce((s, r) => s + (r.suggestedAmount || 0), 0);
  const maxLoss = usedAmount; // 1点なので使用額 = 最大損失

  // streak of pass days (mock)
  const streak = mode === "buy" ? 0 : 4;
  const recentDays = mode === "buy"
    ? "○ ○ ○ ○ ●"            // ●=BUY出た日
    : "○ ○ ○ ○ ○";

  // EV bucket sparkline-ish
  const evBucketRoi = EV_BUCKETS.map(b => b.roi * 100);

  return (
    <div className="stack" style={{ gap: "var(--gap)" }}>

      {/* ---- VERDICT ---- */}
      <div className="verdict" data-mode={mode === "buy" ? "buy" : "success"}>
        <div className="verdict__row">
          <pre className="verdict__ascii">{mode === "buy" ? VERDICT_ASCII_BUY : VERDICT_ASCII_PASS}</pre>
          <div className="verdict__main">
            <div className="verdict__kicker">
              <span>2026·05·21</span>
              <span className="divider">/</span>
              <span>{mode === "buy" ? "BUY CANDIDATES DETECTED" : "NO QUALIFYING CANDIDATES"}</span>
              <span className="divider">/</span>
              <span>RULESET v0.3.1</span>
            </div>
            <div className="verdict__title">
              {mode === "buy" ? `BUY候補 ${buyCount}件` : "本日 全レース見送り"}
            </div>
            <div className="verdict__desc">
              {mode === "buy"
                ? `EV ≥ ${settings.targetEV.toFixed(2)} を満たす候補が ${buyCount}件あります。締切まで5分以上ある順に通知済み。購入は必ず公式オッズで最終確認してください。`
                : `EV ≥ ${settings.targetEV.toFixed(2)} を満たす候補は0件。サンプル不足/オッズ不足/EV不足のため全レース見送り。これは失敗ではなく成功です。`}
            </div>

            <div className="verdict__stats">
              <div className="verdict__stat">
                <div className="label">本日の購入予定</div>
                <div className="value">¥<span className="num">{usedAmount}</span></div>
                <div className="sub">予算 ¥{settings.budget} / 残 ¥{settings.budget - usedAmount}</div>
              </div>
              <div className="verdict__stat">
                <div className="label">最大損失</div>
                <div className="value">¥<span className="num">{maxLoss}</span></div>
                <div className="sub">1点 ¥100 × {buyCount}件</div>
              </div>
              <div className="verdict__stat">
                <div className="label">BUY / WATCH / SKIP</div>
                <div className="value">
                  <span style={{ color: "var(--buy)" }}>{buyCount}</span>
                  <span className="divider"> · </span>
                  <span style={{ color: "var(--watch)" }}>{watchCount}</span>
                  <span className="divider"> · </span>
                  <span style={{ color: "var(--skip-2)" }}>{skipCount}</span>
                </div>
                <div className="sub">候補レース計 {buyCount + watchCount + skipCount}件 (絞込前 144件)</div>
              </div>
              <div className="verdict__stat">
                <div className="label">的中モデル</div>
                <div className="value">v0.3<span className="unit">.1-mvp</span></div>
                <div className="sub">過去90日 ROI 102.3%</div>
              </div>
            </div>

            <div className="verdict__streak">
              <span>買わない日カウンター</span>
              <span className="num">{streak}日連続</span>
              <span className="dim">最長 17日</span>
              <span className="seq">{recentDays} ←今日</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- TOP CANDIDATES / EMPTY ---- */}
      <Panel title="今日の候補" code="CAND" meta={`updated ${new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`} pulse>
        {mode === "buy" ? (
          <div className="grid grid--2">
            {races.filter(r => r.status !== "SKIP").slice(0, 4).map(r => (
              <RaceCard key={r.raceId} race={r} compact onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <PassRationale races={races} settings={settings} />
        )}
      </Panel>

      {/* ---- LOWER ROW: activity + perf ---- */}
      <div className="grid grid--12">
        <div className="col-7">
          <Panel title="判定アクティビティ" code="LOG" meta="latest 8" pulse>
            <div style={{ fontSize: 11, lineHeight: 1.75, fontFamily: "var(--mono)" }}>
              {ACTIVITY.map((a, i) => (
                <div key={i} className="row" style={{ paddingBottom: 4, borderBottom: i < ACTIVITY.length - 1 ? "1px dashed var(--border)" : "none", paddingTop: i === 0 ? 0 : 4 }}>
                  <span className="dim" style={{ width: 64 }}>{a.t}</span>
                  <span style={{ width: 50 }}>
                    {a.lvl === "warn"
                      ? <span style={{ color: "var(--watch)" }}>[WARN]</span>
                      : <span className="dim">[info]</span>}
                  </span>
                  <span style={{ color: a.lvl === "warn" ? "var(--watch-2)" : "var(--text)" }}>{a.msg}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="col-5 stack" style={{ gap: "var(--gap)" }}>
          <Panel title="EV別 90日 ROI" code="BCK" meta="backtest">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80, marginBottom: 8 }}>
              {EV_BUCKETS.map((b, i) => {
                const max = 160;
                const h = Math.max(2, (b.roi * 100 / max) * 80);
                const col = b.roi >= 1.25 ? "var(--buy)" : b.roi >= 1.0 ? "var(--watch)" : "var(--skip)";
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ fontSize: 9, color: "var(--muted)" }}>{(b.roi * 100).toFixed(0)}</div>
                    <div style={{ width: "100%", height: h, background: col, opacity: 0.85 }}></div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {EV_BUCKETS.map((b, i) => (
                <div key={i} style={{ flex: 1, fontSize: 8.5, color: "var(--dim)", textAlign: "center", lineHeight: 1.2 }}>
                  {b.label}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)", fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
              EV ≥ 1.25 のレンジで <b style={{ color: "var(--buy)" }}>ROI 131〜147%</b>。BUY基準を緩めると急速に劣化するため、
              現在のしきい値 <b className="bright">{settings.targetEV.toFixed(2)}</b> を維持。
            </div>
          </Panel>

          <Panel title="安全装置" code="SAF">
            <div style={{ display: "grid", gap: 8, fontSize: 11 }}>
              <SafetyItem label="自動購入"        on={false} note="無効 (実装なし)" />
              <SafetyItem label="ログイン情報保存" on={false} note="無効 (保存しない)" />
              <SafetyItem label="1日予算上限"     on={true}  note={`¥${settings.budget}`} />
              <SafetyItem label="1点上限"         on={true}  note="¥100" />
              <SafetyItem label="締切5分以内 SKIP" on={true} note="有効" />
              <SafetyItem label="重複通知防止"     on={true} note="有効" />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SafetyItem({ label, on, note }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span className="row" style={{ gap: 6 }}>
        <span style={{ color: on ? "var(--buy)" : "var(--dim)", fontFamily: "var(--mono)", width: 12 }}>{on ? "✓" : "×"}</span>
        <span style={{ color: "var(--text)" }}>{label}</span>
      </span>
      <span className="dim" style={{ fontSize: 10 }}>{note}</span>
    </div>
  );
}

function PassRationale({ races, settings }) {
  const reasons = [
    { label: "EV不足 (1.05〜1.24)", count: races.filter(r => r.ev != null && r.ev >= 1.05 && r.ev < 1.25).length },
    { label: "EV不足 (<1.05)",       count: races.filter(r => r.ev != null && r.ev < 1.05).length },
    { label: "オッズ未取得",          count: races.filter(r => r.curOdds == null).length },
    { label: "サンプル不足",          count: races.filter(r => !r.samplesEnough).length },
    { label: "締切5分以内",           count: 0 },
  ];
  return (
    <div className="grid grid--2">
      <div>
        <div className="success-strip" style={{ marginBottom: 12 }}>
          <span className="ico">✓</span>
          <div>
            <b>全レース見送り = 成功</b>
            <div className="dim" style={{ fontSize: 10, marginTop: 2 }}>
              買わなかったことが今日のベストな判断です。
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.7, color: "var(--muted)" }}>
          本日の候補レース <b className="bright">{races.length}件</b> をスキャンしましたが、
          EV ≥ <b className="bright">{settings.targetEV.toFixed(2)}</b> を満たす候補は
          <b style={{ color: "var(--buy-2)" }}> 0件</b>。
          BUY基準を緩めれば候補は出ますが、過去90日の検証では基準を下げるほど ROI が悪化するため、見送ります。
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)", fontSize: 11 }}>
          <div className="dim" style={{ marginBottom: 6 }}>本日の予算消化</div>
          <div className="row">
            <pre className="ascii" style={{ fontSize: 11, color: "var(--buy)", margin: 0 }}>
{`[░░░░░░░░░░░░░░░░░░░░] 0/${settings.budget} 円`}
            </pre>
          </div>
        </div>
      </div>
      <div>
        <div className="dim" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
          見送り内訳
        </div>
        <div className="stack" style={{ gap: 4 }}>
          {reasons.filter(r => r.count > 0).map((r, i) => (
            <div key={i} className="row" style={{ justifyContent: "space-between", fontSize: 11, padding: "5px 0", borderBottom: "1px dashed var(--border)" }}>
              <span>{r.label}</span>
              <span className="num bright">{r.count}件</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const VERDICT_ASCII_PASS = `   ┌─────────┐
   │  PASS   │
   │  ✓✓✓  │
   │  ─────  │
   │  0/0/0  │
   └─────────┘`;

const VERDICT_ASCII_BUY = `   ┌─────────┐
   │  BUY×2  │
   │  ■ ■   │
   │  ─────  │
   │ EV≥1.25 │
   └─────────┘`;

// =============================================================
// BUY LIST (all candidates)
// =============================================================
function ScreenBuyList({ mode, settings, onOpen }) {
  const all = mode === "buy" ? _BD.RACES_BUY_DAY : _BD.RACES_QUIET_DAY;
  const [filter, setFilter] = useState("ALL");
  const filtered = filter === "ALL" ? all : all.filter(r => r.status === filter);

  const c = (s) => all.filter(r => r.status === s).length;

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            { value: "ALL", label: `すべて (${all.length})` },
            { value: "BUY", label: `BUY (${c("BUY")})` },
            { value: "WATCH", label: `WATCH (${c("WATCH")})` },
            { value: "SKIP", label: `SKIP (${c("SKIP")})` },
          ]}
        />
        <span className="spacer flex--1"></span>
        <span className="dim" style={{ fontSize: 11 }}>
          並び替え:
        </span>
        <Seg
          value={"close"}
          onChange={() => {}}
          options={[
            { value: "close", label: "締切順" },
            { value: "ev", label: "EV順" },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Panel>
          <div className="empty">
            <div className="glyph">∅</div>
            <div>該当する候補はありません</div>
            <div className="dim" style={{ marginTop: 6 }}>フィルタを変更してください</div>
          </div>
        </Panel>
      ) : (
        <div className="grid grid--2">
          {filtered.map(r => <RaceCard key={r.raceId} race={r} onOpen={onOpen} />)}
        </div>
      )}

      <div className="warn-strip">
        <span className="ico">⚠</span>
        <div>
          <b>このアプリは購入機能を持ちません。</b> BUY候補も含め、すべての発注は
          公式投票サイトで行ってください。アプリはログイン情報を保存しません。
        </div>
      </div>
    </div>
  );
}

// =============================================================
// RACE DETAIL
// =============================================================
function ScreenDetail({ race, onBack }) {
  if (!race) return null;
  const cd = useCountdown(race.closeMin, race.closeSec);
  const gap = race.curOdds != null ? race.curOdds - race.reqOdds : null;
  const evColor = race.ev >= 1.25 ? "var(--buy-2)" : race.ev != null && race.ev >= 1.05 ? "var(--watch-2)" : "var(--danger)";

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn--ghost btn--xs" onClick={onBack}>← 一覧へ戻る</button>
        <span className="dim" style={{ fontSize: 11 }}>raceId: {race.raceId}</span>
      </div>

      {/* === Header strip === */}
      <Panel className="panel" code="DETAIL" title={`${race.venueName} ${race.raceNo}R`}
        meta={`締切 ${cd.fmt} (${race.closeAt})`} pulse>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="dim" style={{ fontSize: 10, textTransform: "uppercase" }}>判定</div>
            <div style={{ marginTop: 4 }}><StatusChip s={race.status} /></div>
          </div>
          <div style={{ borderLeft: "1px dashed var(--border-2)", paddingLeft: 16 }}>
            <div className="dim" style={{ fontSize: 10, textTransform: "uppercase" }}>買い目</div>
            <div style={{ marginTop: 4 }}><BetNums bet={race.bet} /></div>
          </div>
          <div style={{ borderLeft: "1px dashed var(--border-2)", paddingLeft: 16 }}>
            <div className="dim" style={{ fontSize: 10, textTransform: "uppercase" }}>EV</div>
            <div style={{ marginTop: 4, fontSize: 22, fontWeight: 600, color: evColor, fontVariantNumeric: "tabular-nums" }}>
              {race.ev != null ? race.ev.toFixed(3) : "—"}
            </div>
          </div>
          <span className="spacer flex--1"></span>
          {race.status === "BUY" ? (
            <a className="btn btn--primary" href="https://www.boatrace.jp/owpc/pc/race/odds3t" target="_blank" rel="noopener noreferrer">
              公式で確認して購入 <span className="ext"></span>
            </a>
          ) : (
            <a className="btn" href="https://kyotei24.jp/sp/" target="_blank" rel="noopener noreferrer">
              kyotei24で確認 <span className="ext"></span>
            </a>
          )}
        </div>
      </Panel>

      <div className="grid grid--12">
        {/* === EV breakdown === */}
        <div className="col-7">
          <Panel title="EV の内訳" code="EV.CALC">
            <div style={{ marginBottom: 16 }}>
              <pre className="ascii" style={{ fontSize: 12, lineHeight: 1.7, color: "var(--text)", margin: 0, overflowX: "auto" }}>
{`  EV  =  推定的中率  ×  オッズ
      =  ${(race.pHat * 100).toFixed(2)}%        ×  ${race.curOdds != null ? race.curOdds.toFixed(2) + "倍" : "未取得"}
      =  ${race.ev != null ? race.ev.toFixed(3) : "—"}

  必要オッズ  =  目標EV / 推定的中率
              =  ${race.targetEV.toFixed(2)} / ${(race.pHat * 100).toFixed(2)}%
              =  ${race.reqOdds.toFixed(2)}倍`}
              </pre>
            </div>

            <OddsGauge req={race.reqOdds} current={race.curOdds} status={race.status} />

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <h3 style={{ marginBottom: 10 }}>判定ルールの適合</h3>
              <div className="stack" style={{ gap: 6, fontSize: 11 }}>
                <RuleCheck ok={race.ev != null && race.ev >= 1.25}
                  label="EV ≥ 1.25" v={race.ev != null ? race.ev.toFixed(3) : "—"} />
                <RuleCheck ok={race.samplesEnough}
                  label="サンプル数十分 (n ≥ 600)" v={`n=${race.sampleN}`} />
                <RuleCheck ok={cd.t >= 300}
                  label="締切まで5分以上" v={cd.fmt} />
                <RuleCheck ok={true}
                  label="同レース通知済みでない" v="未通知" />
                <RuleCheck ok={race.suggestedAmount <= 100}
                  label="1点 ¥100 ルール" v={`¥${race.suggestedAmount}`} />
                <RuleCheck ok={race.curOdds != null}
                  label="オッズ取得済み" v={race.curOdds != null ? "kyotei24" : "未取得"} />
              </div>
            </div>
          </Panel>
        </div>

        {/* === Right side === */}
        <div className="col-5 stack" style={{ gap: "var(--gap)" }}>
          <Panel title="推定的中率の根拠" code="P.HAT">
            <div className="stack" style={{ gap: 6, fontSize: 11 }}>
              {(race.reasoning || []).map((r, i) => (
                <div key={i} className="row" style={{ justifyContent: "space-between", padding: "4px 0", borderBottom: i < race.reasoning.length - 1 ? "1px dashed var(--border)" : "none" }}>
                  <span className="muted">{r.k}</span>
                  <span className="bright num">{r.v}</span>
                </div>
              ))}
              <div className="row" style={{ marginTop: 6, padding: "8px 10px", background: "var(--bg)", border: "1px dashed var(--border-2)", fontSize: 10.5 }}>
                <span className="dim">サンプル数</span>
                <span className="spacer flex--1"></span>
                <span className="bright num">{race.sampleN.toLocaleString()}件</span>
              </div>
            </div>
          </Panel>

          {race.status === "BUY" ? (
            <Panel title="通知プレビュー" code="NOTIF" meta="ブラウザ通知">
              <NotifPreview race={race} />
            </Panel>
          ) : (
            <Panel title="通知しない理由" code="SKIP">
              <div className="stack" style={{ gap: 8, fontSize: 11 }}>
                <div className="row" style={{ gap: 6, padding: "6px 0" }}>
                  <span style={{ color: "var(--watch)" }}>⚠</span>
                  <span>{race.notes}</span>
                </div>
                <div className="dim" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
                  通知は BUY 条件をすべて満たした時のみ送信されます。
                  WATCH / SKIP の場合は記録のみで通知は発生しません。
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleCheck({ ok, label, v }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "5px 0", borderBottom: "1px dashed var(--border)" }}>
      <span className="row" style={{ gap: 8 }}>
        <span style={{ color: ok ? "var(--buy)" : "var(--danger)", width: 12, fontFamily: "var(--mono)" }}>{ok ? "✓" : "✗"}</span>
        <span className={ok ? "" : "muted"}>{label}</span>
      </span>
      <span className="bright num" style={{ fontSize: 11 }}>{v}</span>
    </div>
  );
}

function NotifPreview({ race }) {
  return (
    <div className="notif">
      <div className="head">
        <span className="icon">🚤</span>
        <span>BUY候補あり</span>
        <span className="app">Boat EV Notifier · 今</span>
      </div>
      <div className="body">
        <div style={{ marginBottom: 6 }}>
          <b>{race.venueName} {race.raceNo}R</b>
          <span className="dim" style={{ marginLeft: 8, fontSize: 10 }}>締切 {race.closeAt}</span>
        </div>
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <span className="dim" style={{ fontSize: 10 }}>買い目</span>
          <BetNums bet={race.bet} sm />
        </div>
        <div className="dim" style={{ fontSize: 11, lineHeight: 1.8 }}>
          推定的中率 <b className="bright num">{(race.pHat * 100).toFixed(1)}%</b><br />
          必要オッズ <b className="bright num">{race.reqOdds.toFixed(1)}倍 以上</b><br />
          取得オッズ <b className="bright num">{race.curOdds != null ? race.curOdds.toFixed(1) + "倍" : "—"}</b><br />
          EV <b style={{ color: "var(--buy-2)" }} className="num">{race.ev != null ? race.ev.toFixed(2) : "—"}</b>
        </div>
        <div className="meta">
          <span>推奨 ¥{race.suggestedAmount}</span>
          <span>1点のみ</span>
          <span style={{ marginLeft: "auto", color: "var(--watch)" }}>公式オッズで最終確認</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenDashboard, ScreenBuyList, ScreenDetail });
