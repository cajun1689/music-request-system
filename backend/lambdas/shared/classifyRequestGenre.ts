import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import OpenAI from "openai";
import type { GenreName } from "./types";

export interface RequestGenreClassification {
  genre?: GenreName;
  genreLabel: string;
}

const SUPPORTED_LABELS: Record<GenreName, string> = {
  hip_hop: "Hip Hop",
  country: "Country",
  edm: "EDM",
  alternative_rock: "Alternative Rock",
};

const SUPPORTED_BY_LABEL: Record<string, GenreName> = {
  "hip hop": "hip_hop",
  hiphop: "hip_hop",
  rap: "hip_hop",
  country: "country",
  edm: "edm",
  electronic: "edm",
  dance: "edm",
  "alternative rock": "alternative_rock",
  alternative: "alternative_rock",
  rock: "alternative_rock",
};

const SYSTEM_PROMPT = `Classify a nightclub song request by musical genre.

Return STRICT JSON and nothing else:
{ "genre": "hip_hop" | "country" | "edm" | "alternative_rock" | null, "genreLabel": string }

Rules:
- If the song clearly fits one of the supported genres, set "genre" to that key and "genreLabel" to the matching display label:
  hip_hop -> Hip Hop, country -> Country, edm -> EDM, alternative_rock -> Alternative Rock.
- If it does not fit those four, set "genre" to null and set "genreLabel" to the best short genre label, e.g. Pop, R&B, Latin, Reggaeton, Afrobeats, Funk, Soul, Classic Rock, Metal.
- Keep genreLabel under 24 characters.
- If uncertain, choose the most useful broad genre label for a DJ searching a request list.`;

const ssmClient = new SSMClient({});
let cachedApiKey: string | null = null;
let openaiClient: OpenAI | null = null;

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCaseLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bR And B\b/i, "R&B")
    .replace(/\bEdm\b/g, "EDM");
}

function deterministicGenre(songTitle: string, artistName: string): RequestGenreClassification | null {
  const text = normalizeLabel(`${songTitle} ${artistName}`);

  const countryArtists = [
    "neal mccoy",
    "mikel knight",
    "luke combs",
    "morgan wallen",
    "zach bryan",
    "chris stapleton",
    "garth brooks",
  ];
  if (countryArtists.some((artist) => text.includes(artist))) {
    return { genre: "country", genreLabel: SUPPORTED_LABELS.country };
  }

  const hipHopArtists = ["drake", "kendrick lamar", "lil wayne", "future", "nicki minaj", "cardi b"];
  if (hipHopArtists.some((artist) => text.includes(artist))) {
    return { genre: "hip_hop", genreLabel: SUPPORTED_LABELS.hip_hop };
  }

  const edmArtists = ["skrillex", "calvin harris", "tiesto", "fisher", "dom dolla", "illenium"];
  if (edmArtists.some((artist) => text.includes(artist))) {
    return { genre: "edm", genreLabel: SUPPORTED_LABELS.edm };
  }

  const popArtists = ["justin timberlake", "taylor swift", "katy perry", "lady gaga", "bruno mars"];
  if (popArtists.some((artist) => text.includes(artist))) {
    return { genreLabel: "Pop" };
  }

  return null;
}

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
    console.error("classifyRequestGenre: failed to load OpenAI key", String(err));
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

function normalizeClassification(input: unknown): RequestGenreClassification | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { genre?: unknown; genreLabel?: unknown };
  const label = typeof raw.genreLabel === "string" ? titleCaseLabel(raw.genreLabel).slice(0, 24) : "";
  const rawGenre = typeof raw.genre === "string" ? raw.genre : "";
  const normalizedGenre = normalizeLabel(rawGenre);
  const supported = SUPPORTED_BY_LABEL[normalizedGenre] ?? (
    rawGenre === "hip_hop" || rawGenre === "country" || rawGenre === "edm" || rawGenre === "alternative_rock"
      ? rawGenre
      : undefined
  );

  if (supported) {
    return { genre: supported, genreLabel: SUPPORTED_LABELS[supported] };
  }
  if (label) {
    return { genreLabel: label };
  }
  return null;
}

export async function classifyRequestGenre(
  songTitle: string,
  artistName: string,
  selectedGenre?: GenreName,
): Promise<RequestGenreClassification> {
  if (selectedGenre) {
    return { genre: selectedGenre, genreLabel: SUPPORTED_LABELS[selectedGenre] };
  }

  const deterministic = deterministicGenre(songTitle, artistName);
  if (deterministic) return deterministic;

  try {
    const client = await getClient();
    if (!client) return { genreLabel: "Uncategorized" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let response;
    try {
      response = await client.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `${songTitle} - ${artistName}` },
          ],
          max_tokens: 80,
          temperature: 0,
          response_format: { type: "json_object" },
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    const content = response.choices[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : null;
    return normalizeClassification(parsed) ?? { genreLabel: "Uncategorized" };
  } catch (err) {
    console.error("classifyRequestGenre: AI call failed", {
      songTitle: songTitle.slice(0, 60),
      artistName: artistName.slice(0, 60),
      error: String(err),
    });
    return { genreLabel: "Uncategorized" };
  }
}
