import type { LabRow } from "./types.js";

export function parseSelection(selection: string): number[] {
  return selection.split("-").map(Number).filter(Number.isFinite);
}

export function joinSelection(boats: number[]): string {
  return boats.join("-");
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function reverseSecondThird(row: LabRow): string[] {
  const [a, b, c] = row.boats;
  return unique([row.selection, joinSelection([a, c, b])]);
}

export function headFixedFlow(row: LabRow, maxTickets = 6): string[] {
  const [head] = row.boats;
  const tickets: string[] = [];
  for (const second of [1, 2, 3, 4, 5, 6].filter((x) => x !== head)) {
    for (const third of [1, 2, 3, 4, 5, 6].filter((x) => x !== head && x !== second)) {
      tickets.push(joinSelection([head, second, third]));
    }
  }
  return unique(tickets).slice(0, maxTickets);
}

export function top3Box(row: LabRow): string[] {
  return permutations(row.boats).map(joinSelection);
}

export function oddsFiltered(tickets: string[], raceOdds: Map<string, number>, originalSelection: string, originalOdds: number, minOdds: number): string[] {
  return tickets.filter((ticket) => {
    const odds = ticket === originalSelection ? originalOdds : raceOdds.get(ticket);
    return odds != null && odds >= minOdds;
  });
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutations(rest).map((perm) => [item, ...perm]);
  });
}
