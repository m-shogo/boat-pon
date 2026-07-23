export type BuyResultNotificationInput = {
  venue: string;
  raceNo: number;
  betType: string;
  selection: string;
  resultSelection: string | null;
  winningPayoutYen: number | null;
  returned: boolean;
  currentOdds: number | null;
};

export type BuyResultNotificationMessage = {
  title: string;
  body: string;
  status: "hit" | "miss" | "returned";
};

export function buildBuyResultNotification(input: BuyResultNotificationInput): BuyResultNotificationMessage {
  const status = input.returned
    ? "returned"
    : input.resultSelection === input.selection ? "hit" : "miss";
  const statusLabel = status === "hit" ? "🎯 的中" : status === "miss" ? "❌ 外れ" : "↩️ 返還";
  const virtualPayoutYen = status === "hit" ? input.winningPayoutYen ?? 0 : status === "returned" ? 100 : 0;
  const virtualProfitYen = virtualPayoutYen - 100;
  const profitSign = virtualProfitYen >= 0 ? "+" : "";
  const result = input.resultSelection ?? (input.returned ? "返還" : "未確定");
  const officialPayout = input.winningPayoutYen == null
    ? "不明"
    : `${input.winningPayoutYen.toLocaleString()}円`;
  const capturedOdds = input.currentOdds == null ? "未取得" : `${input.currentOdds.toFixed(1)}倍`;

  return {
    status,
    title: `${statusLabel} | BUY事後結果 | ${input.venue} ${input.raceNo}R`,
    body: [
      `paper BUY: ${input.selection}（${input.betType}）`,
      `実着順: ${result}`,
      `的中組の公式払戻: ${officialPayout}（100円あたり）`,
      `取得時オッズ: ${capturedOdds}`,
      `100円仮想払戻: ${virtualPayoutYen.toLocaleString()}円`,
      `100円仮想損益: ${profitSign}${virtualProfitYen.toLocaleString()}円`,
      "",
      "※paper検証。実購入なし。BUYは購入指示ではありません。",
    ].join("\n"),
  };
}
