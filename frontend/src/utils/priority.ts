import type { RequestRecord } from "../types";

// Each $1 of tip lifts the request ~30s earlier in the queue.
const TIP_PRIORITY_MS_PER_DOLLAR = 30_000;
// Each upvote lifts the request ~1 min earlier in the queue.
const UPVOTE_PRIORITY_MS = 60_000;
// Cap the tip-driven boost so a whale can't park forever at #1.
const MAX_TIP_BOOST_DOLLARS = 100;

export function priorityScore(req: Pick<RequestRecord, "position" | "tipAmount" | "upvotes" | "submittedAt">): number {
  const basePos = Number(
    req.position ?? (req.submittedAt ? new Date(req.submittedAt).getTime() : Number.MAX_SAFE_INTEGER),
  );
  const tip = Math.min(req.tipAmount ?? 0, MAX_TIP_BOOST_DOLLARS);
  const tipBoost = tip * TIP_PRIORITY_MS_PER_DOLLAR;
  const upvoteBoost = (req.upvotes ?? 0) * UPVOTE_PRIORITY_MS;
  return basePos - tipBoost - upvoteBoost;
}

export function comparePriority<T extends Pick<RequestRecord, "position" | "tipAmount" | "upvotes" | "submittedAt">>(
  a: T,
  b: T,
): number {
  return priorityScore(a) - priorityScore(b);
}

export interface PriorityBoost {
  tipBoostMin: number;
  upvoteBoostMin: number;
  totalBoostMin: number;
}

export function describeBoost(req: Pick<RequestRecord, "tipAmount" | "upvotes">): PriorityBoost {
  const tip = Math.min(req.tipAmount ?? 0, MAX_TIP_BOOST_DOLLARS);
  const tipBoostMin = (tip * TIP_PRIORITY_MS_PER_DOLLAR) / 60_000;
  const upvoteBoostMin = ((req.upvotes ?? 0) * UPVOTE_PRIORITY_MS) / 60_000;
  return {
    tipBoostMin,
    upvoteBoostMin,
    totalBoostMin: tipBoostMin + upvoteBoostMin,
  };
}
