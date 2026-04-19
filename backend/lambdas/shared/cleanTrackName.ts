import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You clean DJ track names for a "Now Playing" display.
Rules:
- Return ONLY the primary/first song title, nothing else.
- Strip remix tags, edit tags, version labels, "(Dirty)", "(Clean)", etc.
- For mashups/segues (vs, into, /, x), return ONLY the first song.
- Strip featured artist tags (feat., ft., featuring) and everything after them.
- Keep the original title casing — do not lowercase.
- If the input is gibberish or you cannot determine a song title, respond with exactly: UNKNOWN
- Do NOT add quotes, punctuation, or explanation — return the bare title only.`;

const COMPLEX_PATTERNS = [
  /\bvs\.?\b/i,
  /\binto\b/i,
  /\bsegue\b/i,
  /\bwordplay\b/i,
  /\bmashup\b/i,
  /\btransition\b/i,
  /\s\/\s/,
  /\bx\b.*\bx\b/i,
];

const STRIP_PATTERNS: RegExp[] = [
  /\s*\(.*?\)\s*/g,
  /\s*\[.*?\]\s*/g,
  /\s+[-–—]\s+(dirty|clean|explicit|radio)\s*$/i,
  /\s+(dirty|clean|explicit|radio|extended|original|instrumental)\s*$/i,
  /\s+feat\.?\s+.+$/i,
  /\s+ft\.?\s+.+$/i,
  /\s+featuring\s+.+$/i,
];

function needsAI(raw: string): boolean {
  return COMPLEX_PATTERNS.some((pattern) => pattern.test(raw));
}

function regexClean(raw: string): string {
  let cleaned = raw;
  for (const pattern of STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

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
  } catch {
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

export async function cleanTrackName(
  raw: string,
  djBrandName: string,
): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return `${djBrandName} Unreleased Track`;
  }

  if (!needsAI(trimmed)) {
    const cleaned = regexClean(trimmed);
    return cleaned || `${djBrandName} Unreleased Track`;
  }

  try {
    const client = await getClient();
    if (!client) {
      const cleaned = regexClean(trimmed);
      return cleaned || `${djBrandName} Unreleased Track`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await client.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: trimmed },
          ],
          max_tokens: 60,
          temperature: 0,
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }
    const result = response.choices[0]?.message?.content?.trim();
    if (!result || result === "UNKNOWN") {
      console.log("cleanTrackName: AI returned UNKNOWN for", trimmed.slice(0, 60));
      return `${djBrandName} Unreleased Track`;
    }
    return result;
  } catch (err) {
    console.error("cleanTrackName: AI call failed, falling back to regex", {
      input: trimmed.slice(0, 60),
      error: String(err),
    });
    const cleaned = regexClean(trimmed);
    return cleaned || `${djBrandName} Unreleased Track`;
  }
}
