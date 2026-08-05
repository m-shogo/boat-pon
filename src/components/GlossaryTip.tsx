import type { ReactNode } from "react";
import { getGlossaryTerm, type GlossaryTermKey } from "../presentation/glossary";
import { Tooltip } from "./Tooltip";

export function GlossaryTip({ termKey, label }: { termKey: GlossaryTermKey; label?: ReactNode }) {
  const term = getGlossaryTerm(termKey);
  return (
    <Tooltip
      className="glossaryTip"
      accessibleLabel={`${term.label}の説明を開く`}
      label={label ?? term.label}
      hint={(
        <span className="glossaryTipBody">
          <strong>{term.label}</strong>
          <span>{term.plainDescription}</span>
          <span><b>なぜ重要:</b> {term.whyItMatters}</span>
          <span><b>読み方:</b> {term.howToRead}</span>
          <span><b>よくある誤解:</b> {term.commonMistake}</span>
          <span><b>例:</b> {term.formulaOrExample}</span>
        </span>
      )}
    />
  );
}
