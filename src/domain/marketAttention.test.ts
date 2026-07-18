import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionContext, isCompleteVenueDay, parseCloseMinute, type ScheduledRace } from "./marketAttention";

function venueDay(venue:string,start:number):ScheduledRace[]{return Array.from({length:12},(_,i)=>({raceId:`${venue}-${i+1}`,venue,raceNo:i+1,closeAt:`${String(Math.floor((start+i*25)/60)).padStart(2,"0")}:${String((start+i*25)%60).padStart(2,"0")}`}));}

test("締切時刻を日内分へ変換し不正値を拒否する",()=>{assert.equal(parseCloseMinute("17:41"),1061);assert.equal(parseCloseMinute("24:00"),null);});
test("1〜12Rが揃い時刻が増えるvenue-dayだけを通す",()=>{const rows=venueDay("A",600);assert.equal(isCompleteVenueDay(rows),true);rows[11]!.raceNo=11;assert.equal(isCompleteVenueDay(rows),false);});
test("近接締切・開催場数・同一R集中を結果前時刻表から数える",()=>{const a=venueDay("A",600),b=venueDay("B",602),rows=[...a,...b];const context=attentionContext(a[0]!,rows)!;assert.equal(context.activeVenues,2);assert.equal(context.otherWithin2,1);assert.equal(context.sameRoundWithin5,true);});
