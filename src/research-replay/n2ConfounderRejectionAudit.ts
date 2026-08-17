import { canonicalHash } from "./canonical";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import {
  N2_EDGE_SCAN_ALPHA,
  N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL,
  N2_EDGE_SCAN_MIN_UNIQUE_RACES,
} from "./n2EdgeHypothesisScan";

export const N2_CONFOUNDER_REJECTION_AUDIT_VERSION = "n2-confounder-rejection-audit-v1" as const;

export type N2ConfounderFlag = {
  hypothesisId: string;
  flagId: string;
  severity: "info" | "warning" | "blocking";
  detail: string;
};

export type N2RejectionEntry = {
  rejectionVersion: "n2-rejection-entry-v1";
  hypothesisId: string;
  reasonCode: "HOLDOUT_CONFIRMATION_FAILED";
  sourceTask: "TASK-N2-041";
  irreversibleWithinN2V1: true;
  rescueByConfounderExplanationAllowed: false;
  entryDigest: string;
};

export type N2ConfounderAuditItem = {
  hypothesisId: string;
  historicalVerdict: N2EdgeHistoricalConfirmationResult["verdict"];
  disposition:
    | "REJECT_AND_REGISTER"
    | "INSUFFICIENT_HOLDOUT"
    | "CONFIRMED_PENDING_CONFOUNDER_REVIEW"
    | "CONFIRMED_WITH_BLOCKING_CONFOUNDER";
  confounderFlags: N2ConfounderFlag[];
  promotionAuthorized: false;
};

export type N2ConfounderRejectionAuditReport = {
  auditVersion: typeof N2_CONFOUNDER_REJECTION_AUDIT_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  itemCount: number;
  rejectedCount: number;
  insufficientCount: number;
  confirmedPendingCount: number;
  confirmedBlockedCount: number;
  items: N2ConfounderAuditItem[];
  rejectionEntries: N2RejectionEntry[];
  invariants: {
    historicalRejectionCanBeRescued: false;
    insufficientHoldoutIsARejection: false;
    confounderCanBlockPromotion: true;
    confounderCanCreatePromotion: false;
    automaticPromotionAuthorized: false;
  };
  authority: {
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

function unique(values: string[]): string[] { return [...new Set(values)].sort(); }

function blocked(blockers: string[]): N2ConfounderRejectionAuditReport {
  const core={auditVersion:N2_CONFOUNDER_REJECTION_AUDIT_VERSION,status:"BLOCKED" as const,blockers:unique(blockers),itemCount:0,rejectedCount:0,insufficientCount:0,confirmedPendingCount:0,confirmedBlockedCount:0,items:[] as N2ConfounderAuditItem[],rejectionEntries:[] as N2RejectionEntry[],invariants:{historicalRejectionCanBeRescued:false as const,insufficientHoldoutIsARejection:false as const,confounderCanBlockPromotion:true as const,confounderCanCreatePromotion:false as const,automaticPromotionAuthorized:false as const},authority:{currentBuyConnectionAuthorized:false as const,lineConnectionAuthorized:false as const,publicPublishAuthorized:false as const,automatedBettingAuthorized:false as const,productionApplyAuthorized:false as const}};
  return {...core,outputDigest:canonicalHash(core)};
}

function expectedHistoricalVerdict(
  result: N2EdgeHistoricalConfirmationResult,
): N2EdgeHistoricalConfirmationResult["verdict"] {
  if (!result.validation.supportSufficient || !result.test.supportSufficient) return "INSUFFICIENT_HOLDOUT";
  if (result.validation.statisticallyConfirmed && result.test.statisticallyConfirmed) return "HISTORICAL_CONFIRMED";
  return "HISTORICAL_REJECTED";
}

function validateSplitSemantics(
  result: N2EdgeHistoricalConfirmationResult,
  split: "validation" | "test",
): string[] {
  const value = result[split];
  const blockers: string[] = [];
  const expectedSupport = Number.isSafeInteger(value.uniqueRaceCount)
    && value.uniqueRaceCount >= N2_EDGE_SCAN_MIN_UNIQUE_RACES;
  const expectedEffect = value.meanResidual !== null
    && Number.isFinite(value.meanResidual)
    && Math.abs(value.meanResidual) >= N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL;
  const expectedDirection = value.meanResidual !== null
    && Number.isFinite(value.meanResidual)
    && (result.discoveryDirection === "underpredicted" ? value.meanResidual > 0 : value.meanResidual < 0);
  const expectedConfirmed = expectedSupport
    && expectedEffect
    && expectedDirection
    && Number.isFinite(value.holmAdjustedPValue)
    && value.holmAdjustedPValue >= 0
    && value.holmAdjustedPValue <= N2_EDGE_SCAN_ALPHA;

  if (value.supportSufficient !== expectedSupport) blockers.push(`HISTORICAL_SPLIT_SUPPORT_INCONSISTENT:${result.hypothesisId}:${split}`);
  if (value.effectSufficient !== expectedEffect) blockers.push(`HISTORICAL_SPLIT_EFFECT_INCONSISTENT:${result.hypothesisId}:${split}`);
  if (value.directionMatchesDiscovery !== expectedDirection) blockers.push(`HISTORICAL_SPLIT_DIRECTION_INCONSISTENT:${result.hypothesisId}:${split}`);
  if (value.statisticallyConfirmed !== expectedConfirmed) blockers.push(`HISTORICAL_SPLIT_CONFIRMATION_INCONSISTENT:${result.hypothesisId}:${split}`);
  return blockers;
}

export function auditN2ConfoundersAndRejections(input:{
  confirmationResults:N2EdgeHistoricalConfirmationResult[];
  confounderFlags:N2ConfounderFlag[];
}):N2ConfounderRejectionAuditReport{
  const blockers:string[]=[];
  const byId=new Map<string,N2EdgeHistoricalConfirmationResult>();
  for(const result of input.confirmationResults){
    if(byId.has(result.hypothesisId)) blockers.push(`DUPLICATE_CONFIRMATION:${result.hypothesisId}`);
    byId.set(result.hypothesisId,result);
    blockers.push(...validateSplitSemantics(result,"validation"),...validateSplitSemantics(result,"test"));
    const expectedVerdict=expectedHistoricalVerdict(result);
    if(result.verdict!==expectedVerdict) blockers.push(`HISTORICAL_VERDICT_INCONSISTENT:${result.hypothesisId}:${result.verdict}/${expectedVerdict}`);
  }
  const flagsById=new Map<string,N2ConfounderFlag[]>();
  for(const flag of input.confounderFlags){
    if(!byId.has(flag.hypothesisId)){blockers.push(`UNKNOWN_FLAG_HYPOTHESIS:${flag.hypothesisId}`);continue;}
    if(!flag.flagId.trim()||!flag.detail.trim()) blockers.push(`INVALID_CONFOUNDER_FLAG:${flag.hypothesisId}`);
    const current=flagsById.get(flag.hypothesisId)??[];current.push(flag);flagsById.set(flag.hypothesisId,current);
  }
  if(blockers.length) return blocked(blockers);
  const items:N2ConfounderAuditItem[]=[]; const rejectionEntries:N2RejectionEntry[]=[];
  for(const result of [...input.confirmationResults].sort((a,b)=>a.hypothesisId.localeCompare(b.hypothesisId))){
    const flags=[...(flagsById.get(result.hypothesisId)??[])].sort((a,b)=>a.flagId.localeCompare(b.flagId));
    let disposition:N2ConfounderAuditItem["disposition"];
    if(result.verdict==="HISTORICAL_REJECTED"){
      disposition="REJECT_AND_REGISTER";
      const body={rejectionVersion:"n2-rejection-entry-v1" as const,hypothesisId:result.hypothesisId,reasonCode:"HOLDOUT_CONFIRMATION_FAILED" as const,sourceTask:"TASK-N2-041" as const,irreversibleWithinN2V1:true as const,rescueByConfounderExplanationAllowed:false as const};
      rejectionEntries.push({...body,entryDigest:canonicalHash(body)});
    }else if(result.verdict==="INSUFFICIENT_HOLDOUT") disposition="INSUFFICIENT_HOLDOUT";
    else disposition=flags.some(flag=>flag.severity==="blocking")?"CONFIRMED_WITH_BLOCKING_CONFOUNDER":"CONFIRMED_PENDING_CONFOUNDER_REVIEW";
    items.push({hypothesisId:result.hypothesisId,historicalVerdict:result.verdict,disposition,confounderFlags:flags,promotionAuthorized:false});
  }
  const core={auditVersion:N2_CONFOUNDER_REJECTION_AUDIT_VERSION,status:"PASS" as const,blockers:[] as string[],itemCount:items.length,rejectedCount:items.filter(i=>i.disposition==="REJECT_AND_REGISTER").length,insufficientCount:items.filter(i=>i.disposition==="INSUFFICIENT_HOLDOUT").length,confirmedPendingCount:items.filter(i=>i.disposition==="CONFIRMED_PENDING_CONFOUNDER_REVIEW").length,confirmedBlockedCount:items.filter(i=>i.disposition==="CONFIRMED_WITH_BLOCKING_CONFOUNDER").length,items,rejectionEntries,invariants:{historicalRejectionCanBeRescued:false as const,insufficientHoldoutIsARejection:false as const,confounderCanBlockPromotion:true as const,confounderCanCreatePromotion:false as const,automaticPromotionAuthorized:false as const},authority:{currentBuyConnectionAuthorized:false as const,lineConnectionAuthorized:false as const,publicPublishAuthorized:false as const,automatedBettingAuthorized:false as const,productionApplyAuthorized:false as const}};
  return {...core,outputDigest:canonicalHash(core)};
}
