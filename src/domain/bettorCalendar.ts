export type BettorCalendarFactor = { id: string; label: string; group: "calendar"|"weekday"|"season"|"placebo"; match: "month"|"quarter"; test: (date: string) => boolean };

function isCalendarDate(date:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const parsed=Date.parse(`${date}T00:00:00Z`);return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===date;}
function utc(date:string){return isCalendarDate(date)?new Date(`${date}T00:00:00Z`):new Date(NaN);}function day(date:string){return isCalendarDate(date)?Number(date.slice(8,10)):NaN;}function month(date:string){return isCalendarDate(date)?Number(date.slice(5,7)):NaN;}
export function isLastCalendarDays(date:string,count:number){if(!isCalendarDate(date))return false;const d=utc(date),next=new Date(d);next.setUTCDate(d.getUTCDate()+count);return next.getUTCMonth()!==d.getUTCMonth();}

/** 売上を直接観測しない、事前既知の日付proxy。給与・心理効果を断定しない。 */
export const bettorCalendarFactors:BettorCalendarFactor[]=[
  {id:"payday_24_26",label:"24〜26日（給与日proxy）",group:"calendar",match:"month",test:d=>day(d)>=24&&day(d)<=26},
  {id:"month_start_1_3",label:"月初1〜3日",group:"calendar",match:"month",test:d=>day(d)<=3},
  {id:"month_last3",label:"月末3日間",group:"calendar",match:"month",test:d=>isLastCalendarDays(d,3)},
  {id:"gotobi",label:"五十日（5・10・15・20・25・30日）",group:"calendar",match:"month",test:d=>[5,10,15,20,25,30].includes(day(d))},
  {id:"friday",label:"金曜日",group:"weekday",match:"month",test:d=>utc(d).getUTCDay()===5},
  {id:"weekend",label:"土日",group:"weekday",match:"month",test:d=>[0,6].includes(utc(d).getUTCDay())},
  {id:"monday",label:"月曜日",group:"weekday",match:"month",test:d=>utc(d).getUTCDay()===1},
  {id:"bonus_month",label:"6月・12月（賞与月proxy）",group:"season",match:"quarter",test:d=>[6,12].includes(month(d))},
  {id:"seven_day_placebo",label:"7・17・27日_placebo",group:"placebo",match:"month",test:d=>[7,17,27].includes(day(d))},
  {id:"double_day_placebo",label:"11・22日_placebo",group:"placebo",match:"month",test:d=>[11,22].includes(day(d))},
  {id:"prime_day_placebo",label:"素数日_placebo",group:"placebo",match:"month",test:d=>[2,3,5,7,11,13,17,19,23,29,31].includes(day(d))},
];
