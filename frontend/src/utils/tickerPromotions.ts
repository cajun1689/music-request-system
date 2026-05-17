import type { TickerPromotion } from "../types";

export function normalizeTickerPromotions(
  raw: Array<string | TickerPromotion> | undefined | null,
): TickerPromotion[] {
  if (!raw) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        return { text: entry, active: true };
      }
      if (entry && typeof entry === "object" && typeof entry.text === "string") {
        return { text: entry.text, active: entry.active !== false };
      }
      return null;
    })
    .filter((entry): entry is TickerPromotion => entry !== null);
}

export function activeTickerText(
  raw: Array<string | TickerPromotion> | undefined | null,
): string[] {
  return normalizeTickerPromotions(raw)
    .filter((entry) => entry.active && entry.text.trim().length > 0)
    .map((entry) => entry.text);
}
