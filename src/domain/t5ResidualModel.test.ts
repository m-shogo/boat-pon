import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProbabilityModel, fitSelectionFactors, marketModel, selectionResidualModel, temperatureModel, type ResidualRace } from "./t5ResidualModel";

const races: ResidualRace[] = [
  { raceId:"r1",date:"2026-06-01",venue:"A",raceNo:1,winner:"1-2-3",payoutYen:500,outcomes:[{selection:"1-2-3",marketProbability:0.6,odds:2},{selection:"2-1-3",marketProbability:0.4,odds:3}] },
  { raceId:"r2",date:"2026-06-02",venue:"A",raceNo:2,winner:"2-1-3",payoutYen:700,outcomes:[{selection:"1-2-3",marketProbability:0.7,odds:2},{selection:"2-1-3",marketProbability:0.3,odds:4}] },
];

test("市場確率をそのまま評価できる",()=>{
  const result=evaluateProbabilityModel(races,marketModel);
  assert.equal(result.n,2); assert.equal(result.hits,1); assert.equal(result.payoutRoi,2.5);
  assert.equal(result.payoutRoiExTop1,0);
  assert.equal(result.payoutRoiExTop2,0);
});

test("除外ROIの分母は実際に除外した的中数だけを引く",()=>{
  const oneHit=[...races,{...races[1],raceId:"r3",date:"2026-06-03"}];
  const result=evaluateProbabilityModel(oneHit,marketModel);
  assert.equal(result.hits,1);
  assert.equal(result.payoutRoiExTop1,0);
  assert.equal(result.payoutRoiExTop2,0);
});

test("temperature変換後も確率合計は1",()=>{
  const probabilities=temperatureModel(0.75)(races[0]);
  assert.ok(Math.abs([...probabilities.values()].reduce((a,b)=>a+b,0)-1)<1e-12);
});

test("selection残差係数は実績が市場期待を上回る買い目を引き上げる",()=>{
  const factors=fitSelectionFactors(races,10);
  assert.ok((factors.get("2-1-3")??0)>(factors.get("1-2-3")??0));
  const probabilities=selectionResidualModel(factors)(races[0]);
  assert.ok(Math.abs([...probabilities.values()].reduce((a,b)=>a+b,0)-1)<1e-12);
});
