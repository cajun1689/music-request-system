import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import OpenAI from "openai";

export type ShoutoutSeverity = "ok" | "warn" | "block";

export interface ModerationResult {
  flagged: boolean;
  severity: ShoutoutSeverity;
  categories: string[];
  reason?: string;
}

const SYSTEM_PROMPT = `You are a moderator for a nightclub song-request app's "shoutout" feature. A shoutout is a short message that DJs may scroll across an in-venue ticker.

Return STRICT JSON with this shape and NOTHING ELSE:
{ "flagged": boolean, "severity": "ok" | "warn" | "block", "categories": string[], "reason": string }

Severity rules:
- "block" — slurs, explicit hate speech, sexual content involving minors, calls for violence, doxxing, naming a competing DJ/venue/brand in a promotional way, anything illegal.
- "warn" — insults aimed at the DJ ("this dj sucks", "boo", "play something else", "you're trash"), insults aimed at the venue, profanity, sexual innuendo, drug references, demeaning content, off-topic spam, attempts to advertise, attempts to give shoutouts to other businesses.
- "ok" — friendly birthday/anniversary/dedication/hype messages, asking for a song, generic crowd hype.

Categories must be lowercase short tags (e.g. "hate","slur","insult-dj","insult-venue","profanity","sexual","drugs","violence","competitor","ad","spam","off-topic","dox").

Reason: 1 short sentence (max 12 words) explaining the call. Empty string if severity is "ok".

Examples:
shoutout: "happy birthday Sarah!!" -> {"flagged":false,"severity":"ok","categories":[],"reason":""}
shoutout: "this DJ sucks play better music" -> {"flagged":true,"severity":"warn","categories":["insult-dj"],"reason":"Insulting the DJ."}
shoutout: "boo you stink" -> {"flagged":true,"severity":"warn","categories":["insult-dj"],"reason":"Insult aimed at the DJ."}
shoutout: "shoutout to DJ Mike at Rival Bar next door" -> {"flagged":true,"severity":"warn","categories":["competitor","ad"],"reason":"Promotes a competing DJ/venue."}
shoutout: "kill <name>" -> {"flagged":true,"severity":"block","categories":["violence"],"reason":"Threat of violence."}`;

const ssmClient = new SSMClient({});
let cachedApiKey: string | null = null;
let openaiClient: OpenAI | null = null;

async function getApiKey(): Promise<string | null> {
  if (cachedApiKey) return cachedApiKey;
  const paramName = process.env.OPENAI_API_KEY_SSM_PARAM;
  if (!paramName) return null;
  try {
    const result = await ssmClient.send(
      new GetParameterCommand({ Name: paramName, WithDecryption: true }),
    );
    cachedApiKey = result.Parameter?.Value ?? null;
    return cachedApiKey;
  } catch (err) {
    console.error("moderateShoutout: failed to load OpenAI key", String(err));
    return null;
  }
}

async function getClient(): Promise<OpenAI | null> {
  if (openaiClient) return openaiClient;
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// Cheap deterministic prefilter so we don't burn an API call on obvious slurs / promo.
const HARD_BLOCK_PATTERNS: Array<{ pattern: RegExp; category: string; reason: string }> = [
  { pattern: /\bkill\s+(yourself|urself|y[ou]rself)\b/i, category: "violence", reason: "Self-harm encouragement." },
];

const HARD_WARN_PATTERNS: Array<{ pattern: RegExp; category: string; reason: string }> = [
  { pattern: /\b(this\s+dj|dj)\s+(sucks?|blows?|stinks?)\b/i, category: "insult-dj", reason: "Insult aimed at the DJ." },
  { pattern: /\b(boo+|fuck\s+this\s+dj|trash\s+dj|worst\s+dj)\b/i, category: "insult-dj", reason: "Insult aimed at the DJ." },
  { pattern: /\b(play\s+(something|anything)\s+(else|better)|you\s+suck)\b/i, category: "insult-dj", reason: "Hostile feedback to the DJ." },
];

function precheck(shoutout: string): ModerationResult | null {
  for (const rule of HARD_BLOCK_PATTERNS) {
    if (rule.pattern.test(shoutout)) {
      return { flagged: true, severity: "block", categories: [rule.category], reason: rule.reason };
    }
  }
  for (const rule of HARD_WARN_PATTERNS) {
    if (rule.pattern.test(shoutout)) {
      return { flagged: true, severity: "warn", categories: [rule.category], reason: rule.reason };
    }
  }
  return null;
}

function safeParse(raw: string | null | undefined): ModerationResult | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<ModerationResult>;
    const severity = parsed.severity === "block" || parsed.severity === "warn" ? parsed.severity : "ok";
    return {
      flagged: severity !== "ok",
      severity,
      categories: Array.isArray(parsed.categories) ? parsed.categories.map(String) : [],
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    };
  } catch (err) {
    console.error("moderateShoutout: failed to parse model output", { raw: cleaned.slice(0, 200), err: String(err) });
    return null;
  }
}

export async function moderateShoutout(
  shoutout: string,
  context?: { djBrandName?: string; venueName?: string },
): Promise<ModerationResult> {
  const trimmed = shoutout.trim();
  if (!trimmed) {
    return { flagged: false, severity: "ok", categories: [] };
  }

  const pre = precheck(trimmed);
  if (pre && pre.severity === "block") return pre;

  try {
    const client = await getClient();
    if (!client) {
      console.log("moderateShoutout: no OpenAI key configured, falling back to regex precheck");
      return pre ?? { flagged: false, severity: "ok", categories: [] };
    }

    let openaiMod: { flagged: boolean; categories: Record<string, boolean> } | null = null;
    try {
      const modController = new AbortController();
      const modTimeout = setTimeout(() => modController.abort(), 4000);
      try {
        const mod = await client.moderations.create(
          { model: "omni-moderation-latest", input: trimmed },
          { signal: modController.signal },
        );
        const first = mod.results[0];
        if (first) {
          openaiMod = {
            flagged: Boolean(first.flagged),
            categories: (first.categories as unknown as Record<string, boolean>) ?? {},
          };
        }
      } finally {
        clearTimeout(modTimeout);
      }
    } catch (err) {
      console.error("moderateShoutout: moderations endpoint failed", String(err));
    }

    if (openaiMod?.flagged) {
      const hits = Object.entries(openaiMod.categories)
        .filter(([, v]) => v)
        .map(([k]) => k.replace(/\//g, "-"));
      const hardBlock = hits.some((c) =>
        ["hate", "hate-threatening", "sexual-minors", "violence", "self-harm-intent", "self-harm-instructions"].includes(c),
      );
      return {
        flagged: true,
        severity: hardBlock ? "block" : "warn",
        categories: hits.length ? hits : ["flagged"],
        reason: hardBlock ? "OpenAI moderation flagged this as policy-violating." : "OpenAI moderation flagged this content.",
      };
    }

    const ctxLine = context?.djBrandName || context?.venueName
      ? `\nContext — DJ: "${context?.djBrandName ?? ""}", Venue: "${context?.venueName ?? ""}".`
      : "";

    const chatController = new AbortController();
    const chatTimeout = setTimeout(() => chatController.abort(), 5000);
    let response;
    try {
      response = await client.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT + ctxLine },
            { role: "user", content: trimmed },
          ],
          max_tokens: 120,
          temperature: 0,
          response_format: { type: "json_object" },
        },
        { signal: chatController.signal },
      );
    } finally {
      clearTimeout(chatTimeout);
    }

    const aiResult = safeParse(response.choices[0]?.message?.content);
    if (aiResult) {
      if (pre && (pre.severity === "warn" || pre.severity === "block") && aiResult.severity === "ok") {
        return pre;
      }
      return aiResult;
    }
    return pre ?? { flagged: false, severity: "ok", categories: [] };
  } catch (err) {
    console.error("moderateShoutout: unexpected failure", String(err));
    return pre ?? { flagged: false, severity: "ok", categories: [] };
  }
}
