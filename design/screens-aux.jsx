// ============================================================
// History/Backtest + Notifications + Settings screens
// ============================================================

// Aliased to avoid top-level identifier clashes across <script type="text/babel"> files.
const HIST    = window.BoatData.HISTORY;
const EVB     = window.BoatData.EV_BUCKETS;
const VR_LIST = window.BoatData.VENUE_ROI;
const N_LIST  = window.BoatData.NOTIFS;

// =============================================================
// HISTORY / BACKTEST
// =============================================================
function ScreenHistory() {
  const buys = HIST.filter(h => h.status === "BUY");
  const watches = HIST.filter(h => h.status === "WATCH");
  const passes = HIST.filter(h => h.status === "PASS");
  const hits = buys.filter(h => h.result === "HIT").length;
  const totalAmount = buys.reduce((s, h) => s + h.amount, 0);
  const totalPayout = buys.reduce((s, h) => s + h.payout, 0);
  const roi = totalAmount > 0 ? totalPayout / totalAmount : 0;
  const hitRate = buys.length > 0 ? hits / buys.length : 0;

  // would-have-bought analysis
  const watchHits = watches.filter(w => w.result === "HIT").length;

  return (
    <div className="stack">
      {/* KPI row */}
      <div className="grid grid--3">
        <Kpi label="BUY 件数" value={buys.length} sub={`過去 12 日 / PASS ${passes.length}日`} />
        <Kpi label="的中率" value={(hitRate * 100).toFixed(1)} unit="%"
             sub={`${hits} / ${buys.length}`}
             bar={hitRate * 100 * 2}
             barCls={hitRate >= 0.3 ? "" : "is-watch"} />
        <Kpi label="ROI"
             value={(roi * 100).toFixed(1)} unit="%"
             sub={`払戻 ¥${totalPayout.toLocaleString()} / 投入 ¥${totalAmount.toLocaleString()}`}
             accent={roi >= 1 ? "var(--buy)" : "var(--danger)"}
             deltaPos={roi >= 1 ? `+¥${(totalPayout - totalAmount).toLocaleString()}` : null}
             deltaNeg={roi < 1 ? `−¥${(totalAmount - totalPayout).toLocaleString()}` : null} />
      </div>

      <div className="grid grid--12">
        {/* EV bucket */}
        <div className="col-7">
          <Panel title="EV別 成績" code="BCK.EV" meta="n=436 (過去90日)">
            <table className="tbl">
              <thead>
                <tr>
                  <th>EVレンジ</th>
                  <th className="num" style={{textAlign:"right"}}>n</th>
                  <th className="num" style={{textAlign:"right"}}>的中</th>
                  <th className="num" style={{textAlign:"right"}}>的中率</th>
                  <th>ROI</th>
                  <th className="num" style={{textAlign:"right"}}>ROI%</th>
                </tr>
              </thead>
              <tbody>
                {EVB.map((b, i) => {
                  const barPct = Math.min(100, (b.roi / 1.6) * 100);
                  const goodCutoff = b.label === "1.25-1.30" || b.label === "1.30+";
                  const color = b.roi >= 1.25 ? "var(--buy)" : b.roi >= 1.0 ? "var(--watch)" : "var(--skip)";
                  return (
                    <tr key={i} style={goodCutoff ? { background: "var(--buy-bg)" } : null}>
                      <td><span className={goodCutoff ? "bright" : ""}>{b.label}</span> {goodCutoff && <span className="chip buy" style={{ fontSize: 9, marginLeft: 6 }}>BUY帯</span>}</td>
                      <td className="num" style={{textAlign:"right"}}>{b.n}</td>
                      <td className="num" style={{textAlign:"right"}}>{b.hit}</td>
                      <td className="num" style={{textAlign:"right"}}>{(b.hitRate * 100).toFixed(1)}%</td>
                      <td style={{ width: 140 }}>
                        <div style={{ height: 8, background: "var(--bg)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
                          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: barPct + "%", background: color }}></div>
                          <div style={{ position: "absolute", top: -2, bottom: -2, left: (1.0 / 1.6 * 100) + "%", width: 1, background: "var(--bright)" }}></div>
                        </div>
                      </td>
                      <td className="num" style={{textAlign:"right", color, fontWeight: 600}}>{(b.roi * 100).toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
              <span style={{ color: "var(--buy)" }}>■</span> ROI ≥ 1.25 ·
              <span style={{ color: "var(--watch)", marginLeft: 8 }}>■</span> 1.00〜1.25 ·
              <span style={{ color: "var(--skip)", marginLeft: 8 }}>■</span> &lt; 1.00 (損失帯)
            </div>
          </Panel>
        </div>

        {/* Venue ROI */}
        <div className="col-5">
          <Panel title="会場別 ROI (TOP 8)" code="BCK.VEN">
            <div className="barchart">
              {VR_LIST.map((v, i) => {
                const pct = Math.min(100, (v.roi / 1.4) * 100);
                const color = v.roi >= 1.1 ? "var(--buy)" : v.roi >= 1.0 ? "var(--watch)" : "var(--danger)";
                return (
                  <div key={i} className="barchart__row" style={{ gridTemplateColumns: "70px 1fr 70px" }}>
                    <span className="label" style={{ color: "var(--text)" }}>{v.venue} <span className="dim">({v.n})</span></span>
                    <div className="bar">
                      <div className="fill" style={{ width: pct + "%", background: color }}></div>
                      <div style={{ position: "absolute", top: -1, bottom: -1, left: (1.0 / 1.4 * 100) + "%", width: 1, background: "var(--bright)" }}></div>
                    </div>
                    <span className="val" style={{ color, fontWeight: 600 }}>{(v.roi * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>

      {/* Pass analysis */}
      <Panel title="“買わなかった” WATCH の検証" code="WATCH.SHADOW">
        <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
          <div style={{ minWidth: 220 }}>
            <div className="dim" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>仮にWATCHも買っていたら</div>
            <div style={{ fontSize: 26, fontWeight: 600, marginTop: 6, color: watchHits >= watches.length / 4 ? "var(--watch-2)" : "var(--buy-2)" }}>
              {watchHits} <span className="dim" style={{ fontSize: 13 }}>/ {watches.length} hit</span>
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
              WATCH を全部買っていた場合の仮想成績。<br />
              EV 1.05-1.24 帯の ROI は平均 <b className="bright">{(EVB.slice(1,4).reduce((s,b)=>s+b.roi,0)/3*100).toFixed(0)}%</b>。
              <br />→ <b style={{ color: "var(--watch-2)" }}>買わなくて正解</b>
            </div>
          </div>
          <div className="flex--1">
            <pre className="ascii dim" style={{ fontSize: 11, margin: 0, lineHeight: 1.6 }}>
{`  ┌────────────────────────────────────────────────────────────┐
  │  "買わない日 = 成功" 検証                                  │
  ├────────────────────────────────────────────────────────────┤
  │  PASS日数        : 4日 (33.3%)    → 損失なし              │
  │  PASSの代替購入  : −¥1,420 (推定)  → 買わなくて正解        │
  │  WATCH変換BUY    : ROI 98%        → 期待値マイナス        │
  │                                                            │
  │  結論: 現状のBUY基準を維持。緩めないこと。                 │
  └────────────────────────────────────────────────────────────┘`}
            </pre>
          </div>
        </div>
      </Panel>

      {/* Decision log */}
      <Panel title="判定ログ" code="LOG.DEC" meta={`${HIST.length} 件`}>
        <table className="tbl">
          <thead>
            <tr>
              <th>日付</th>
              <th>会場</th>
              <th>R</th>
              <th>買い目</th>
              <th>判定</th>
              <th className="num" style={{textAlign:"right"}}>推定%</th>
              <th className="num" style={{textAlign:"right"}}>オッズ</th>
              <th className="num" style={{textAlign:"right"}}>EV</th>
              <th className="num" style={{textAlign:"right"}}>投入</th>
              <th>結果</th>
              <th className="num" style={{textAlign:"right"}}>払戻</th>
            </tr>
          </thead>
          <tbody>
            {HIST.map((h, i) => (
              <tr key={i}>
                <td className="dim">{h.date}</td>
                <td>{h.venue}</td>
                <td className="dim">{h.r > 0 ? h.r + "R" : "—"}</td>
                <td className="num">{h.bet}</td>
                <td><StatusChip s={h.status} sm /></td>
                <td className="num" style={{textAlign:"right"}}>{h.pHat != null ? (h.pHat * 100).toFixed(1) + "%" : "—"}</td>
                <td className="num" style={{textAlign:"right"}}>{h.odds != null ? h.odds.toFixed(1) : "—"}</td>
                <td className="num" style={{textAlign:"right", color: h.ev != null ? (h.ev >= 1.25 ? "var(--buy)" : h.ev >= 1.05 ? "var(--watch)" : "var(--skip)") : null}}>
                  {h.ev != null ? h.ev.toFixed(2) : "—"}
                </td>
                <td className="num" style={{textAlign:"right"}}>{h.amount > 0 ? "¥" + h.amount : <span className="dim">—</span>}</td>
                <td>{h.result !== "—" ? <StatusChip s={h.result} sm /> : <span className="dim">—</span>}</td>
                <td className="num" style={{textAlign:"right", color: h.payout > 0 ? "var(--buy-2)" : null, fontWeight: h.payout > 0 ? 600 : 400}}>
                  {h.payout > 0 ? "¥" + h.payout.toLocaleString() : <span className="dim">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// =============================================================
// NOTIFICATIONS
// =============================================================
function ScreenNotif({ mode }) {
  const races = mode === "buy" ? window.BoatData.RACES_BUY_DAY : window.BoatData.RACES_QUIET_DAY;
  const todayBuys = races.filter(r => r.status === "BUY");

  return (
    <div className="stack">
      <div className="grid grid--12">
        <div className="col-7">
          <Panel title="通知履歴" code="NOTIF.LOG" meta={`${N_LIST.length} 件`}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>送信日時</th>
                  <th>会場</th>
                  <th>R</th>
                  <th className="num" style={{textAlign:"right"}}>EV</th>
                  <th>状態</th>
                  <th>宛先</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {N_LIST.map(n => (
                  <tr key={n.id}>
                    <td className="dim">{n.at}</td>
                    <td>{n.venue}</td>
                    <td className="dim">{n.r}R</td>
                    <td className="num" style={{textAlign:"right", color: "var(--buy)", fontWeight: 600}}>{n.ev.toFixed(2)}</td>
                    <td><StatusChip s="SENT" sm /></td>
                    <td className="dim">{n.target}</td>
                    <td>{n.result ? <StatusChip s={n.result} sm /> : <span className="dim">待ち</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <div style={{ height: 14 }}></div>

          <Panel title="通知ルール" code="NOTIF.RULE">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <h3 style={{ marginBottom: 10 }}>通知する条件</h3>
                <div className="stack" style={{ gap: 4, fontSize: 11 }}>
                  <Rule ok label="EV ≥ 1.25" />
                  <Rule ok label="サンプル数十分 (n ≥ 600)" />
                  <Rule ok label="1日予算以内" />
                  <Rule ok label="締切まで5分以上" />
                  <Rule ok label="同レース未通知" />
                  <Rule ok label="欠場/返還情報なし" />
                </div>
              </div>
              <div>
                <h3 style={{ marginBottom: 10 }}>通知しない条件</h3>
                <div className="stack" style={{ gap: 4, fontSize: 11 }}>
                  <Rule no label="WATCH (EV 1.05-1.24)" />
                  <Rule no label="SKIP (EV < 1.05)" />
                  <Rule no label="サンプル不足" />
                  <Rule no label="オッズ未取得" />
                  <Rule no label="予算上限到達" />
                  <Rule no label="締切5分以内" />
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <div className="col-5 stack">
          <Panel title="プレビュー" code="NOTIF.PREV" meta="ブラウザ通知">
            {todayBuys.length > 0 ? (
              <NotifPreview race={todayBuys[0]} />
            ) : (
              <div className="empty">
                <div className="glyph">∅</div>
                <div>送信予定の通知はありません</div>
                <div className="dim" style={{ marginTop: 6, fontSize: 11 }}>
                  BUY条件を満たすレースがあれば<br />
                  自動で通知が送信されます
                </div>
              </div>
            )}
          </Panel>

          <Panel title="通知先" code="NOTIF.DST">
            <div className="stack" style={{ gap: 10, fontSize: 11 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 6 }}>
                  <span style={{ color: "var(--buy)" }}>●</span>
                  ブラウザ通知
                </span>
                <span className="dim" style={{ fontSize: 10, fontFamily: "var(--mono)" }}>
                  …/api/webhooks/****
                </span>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 6 }}>
                  <span style={{ color: "var(--dim)" }}>○</span>
                  ブラウザ通知
                </span>
                <span className="dim" style={{ fontSize: 10 }}>未設定</span>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 6 }}>
                  <span style={{ color: "var(--dim)" }}>○</span>
                  メール
                </span>
                <span className="dim" style={{ fontSize: 10 }}>未設定</span>
              </div>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
              <button className="btn btn--xs btn--ghost" style={{ width: "100%", justifyContent: "center" }}>
                通知先を編集
              </button>
            </div>
          </Panel>

          <Panel title="本日 制限到達状況" code="NOTIF.LIM">
            <div className="stack" style={{ gap: 10, fontSize: 11 }}>
              <LimitBar label="通知数" cur={todayBuys.length} max={10} unit="件" />
              <LimitBar label="予算消化" cur={todayBuys.length * 100} max={1000} unit="円" />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Rule({ ok, no, label }) {
  return (
    <div className="row" style={{ gap: 8, padding: "3px 0" }}>
      <span style={{ width: 12, color: ok ? "var(--buy)" : "var(--skip-2)", fontFamily: "var(--mono)" }}>{ok ? "✓" : "−"}</span>
      <span className={no ? "muted" : ""}>{label}</span>
    </div>
  );
}

function LimitBar({ label, cur, max, unit }) {
  const pct = (cur / max) * 100;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <span className="muted">{label}</span>
        <span className="num bright">{cur} / {max} {unit}</span>
      </div>
      <div style={{ height: 6, background: "var(--bg)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: Math.min(100, pct) + "%", background: pct >= 80 ? "var(--watch)" : "var(--buy)" }}></div>
      </div>
    </div>
  );
}

// =============================================================
// SETTINGS
// =============================================================
function ScreenSettings({ settings, onChange }) {
  const set = (k, v) => onChange({ ...settings, [k]: v });

  return (
    <div className="stack">
      <div className="warn-strip">
        <span className="ico">⚠</span>
        <div>
          このアプリは <b>自動購入を一切行いません</b>。
          ログイン情報も保存しません。すべての発注は公式投票サイトで行います。
        </div>
      </div>

      <Panel title="判定パラメータ" code="CONF.JUDGE">
        <div className="field">
          <div className="lbl">
            目標EV (BUYしきい値)
            <div className="desc">EV がこの値以上の時のみ BUY 候補に。1.20 にすると候補は増えるが ROI は劣化します。</div>
          </div>
          <div className="ctrl">
            <Seg
              value={settings.targetEV}
              onChange={(v) => set("targetEV", v)}
              options={[
                { value: 1.20, label: "1.20 (緩い)" },
                { value: 1.25, label: "1.25 (推奨)" },
                { value: 1.30, label: "1.30 (厳しい)" },
                { value: 1.40, label: "1.40 (超厳格)" },
              ]}
            />
          </div>
        </div>

        <div className="field">
          <div className="lbl">
            WATCH しきい値
            <div className="desc">この値以上 / 目標EV未満を WATCH に。記録のみで通知はしません。</div>
          </div>
          <div className="ctrl">
            <input className="input" value="1.05" readOnly />
            <span className="dim" style={{ fontSize: 10 }}>固定 (MVP)</span>
          </div>
        </div>

        <div className="field">
          <div className="lbl">
            最低サンプル数
            <div className="desc">同条件レースがこれ未満ならサンプル不足として SKIP。</div>
          </div>
          <div className="ctrl">
            <input className="input" value="600" readOnly />
            <span className="dim" style={{ fontSize: 10 }}>レース</span>
          </div>
        </div>

        <div className="field">
          <div className="lbl">
            締切前 SKIP マージン
            <div className="desc">締切までこの時間以内になったレースは SKIP。</div>
          </div>
          <div className="ctrl">
            <input className="input" value="5" readOnly />
            <span className="dim" style={{ fontSize: 10 }}>分</span>
          </div>
        </div>
      </Panel>

      <Panel title="予算ルール" code="CONF.BUDGET">
        <div className="field">
          <div className="lbl">
            1日予算
            <div className="desc">本日の BUY 合計の上限。超えそうな場合は新規 BUY を SKIP します。</div>
          </div>
          <div className="ctrl">
            <Seg
              value={settings.budget}
              onChange={(v) => set("budget", v)}
              options={[
                { value: 500,  label: "¥500 (極めて厳しめ)" },
                { value: 1000, label: "¥1,000 (推奨)" },
                { value: 2000, label: "¥2,000 (緩め)" },
              ]}
            />
          </div>
        </div>

        <div className="field">
          <div className="lbl">
            1点あたり
            <div className="desc">1買い目あたりの金額。MVPでは100円固定。</div>
          </div>
          <div className="ctrl">
            <input className="input" value="100" readOnly />
            <span className="dim" style={{ fontSize: 10 }}>円 / 1点</span>
          </div>
        </div>

        <div className="field">
          <div className="lbl">
            1日最大 BUY 数
            <div className="desc">通知件数の上限。これを超えると新規 BUY を SKIP。</div>
          </div>
          <div className="ctrl">
            <input className="input" value="10" readOnly />
            <span className="dim" style={{ fontSize: 10 }}>件 / 日</span>
          </div>
        </div>
      </Panel>

      <Panel title="表示設定" code="CONF.UI">
        <div className="field">
          <div className="lbl">カラーモード</div>
          <div className="ctrl">
            <Seg
              value={settings.theme}
              onChange={(v) => set("theme", v)}
              options={[
                { value: "dark", label: "ダーク" },
                { value: "light", label: "ライト" },
              ]}
            />
          </div>
        </div>
        <div className="field">
          <div className="lbl">情報密度</div>
          <div className="ctrl">
            <Seg
              value={settings.density}
              onChange={(v) => set("density", v)}
              options={[
                { value: "dense", label: "密 (推奨)" },
                { value: "loose", label: "ゆったり" },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel title="データ取得" code="CONF.FETCH">
        <div className="field">
          <div className="lbl">
            kyotei24 取得頻度
            <div className="desc">候補レースのみ・締切10〜5分前に1回。サイト運営に配慮した最小頻度。</div>
          </div>
          <div className="ctrl">
            <input className="input" value="候補のみ / 締切前1回" readOnly style={{ minWidth: 200 }} />
          </div>
        </div>
        <div className="field">
          <div className="lbl">
            BOAT RACE公式ダウンロード
            <div className="desc">番組表・競走成績はローカル保存。同日2回まで。</div>
          </div>
          <div className="ctrl">
            <span className="chip buy"><span className="dot"></span>有効</span>
            <span className="dim" style={{ fontSize: 10 }}>最終取得 15:10</span>
          </div>
        </div>
        <div className="field">
          <div className="lbl">
            ローカル保存
            <div className="desc">raw / normalized / sqlite の3層で保存。</div>
          </div>
          <div className="ctrl">
            <span className="chip buy"><span className="dot"></span>有効</span>
            <span className="dim" style={{ fontSize: 10 }}>data/boat.sqlite · 4.2 MB</span>
          </div>
        </div>
      </Panel>

      <Panel title="安全規約" code="CONF.SAF">
        <div className="stack" style={{ gap: 0 }}>
          <SafetyLock label="自動購入"          locked />
          <SafetyLock label="自動投票"          locked />
          <SafetyLock label="ログイン情報の保存" locked />
          <SafetyLock label="投票サイト操作の自動化" locked />
          <SafetyLock label="全会場全レース毎分取得" locked />
          <SafetyLock label="オッズ全パターン連打" locked />
          <SafetyLock label="データ再配布"      locked />
          <SafetyLock label="商用利用"          locked />
        </div>
        <div className="dim" style={{ fontSize: 10.5, lineHeight: 1.6, marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
          上記はアプリレベルで <b className="bright">実装されていません</b>。
          設定からも有効化できません。これは仕様です。
        </div>
      </Panel>
    </div>
  );
}

function SafetyLock({ label, locked }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px dashed var(--border)", fontSize: 11 }}>
      <span className="row" style={{ gap: 8 }}>
        <span style={{ color: "var(--danger)" }}>🔒</span>
        <span>{label}</span>
      </span>
      <span className="chip danger" style={{ fontSize: 9 }}>
        <span className="dot"></span>NEVER
      </span>
    </div>
  );
}

Object.assign(window, { ScreenHistory, ScreenNotif, ScreenSettings });
