import assert from "node:assert/strict";import { test } from "node:test";import { bettorCalendarFactors,isLastCalendarDays } from "./bettorCalendar";
test("月末3日間は月長とうるう年を考慮する",()=>{assert.equal(isLastCalendarDays("2024-02-27",3),true);assert.equal(isLastCalendarDays("2024-02-26",3),false);assert.equal(isLastCalendarDays("2025-04-28",3),true);});
test("給与日proxyとplaceboを別groupで返す",()=>{assert.equal(bettorCalendarFactors.find(f=>f.id==="payday_24_26")!.test("2025-07-25"),true);assert.equal(bettorCalendarFactors.find(f=>f.id==="seven_day_placebo")!.group,"placebo");});
