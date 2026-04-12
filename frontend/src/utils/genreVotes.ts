import type { EventRecord, GenreName, GenreVotes } from "../types";

export const GENRE_VOTE_THRESHOLD = 15;

export const GENRE_LABELS: Record<GenreName, string> = {
  hip_hop: "Hip Hop",
  country: "Country",
  edm: "EDM",
  alternative_rock: "Alternative Rock",
};

export const ALL_GENRES: GenreName[] = ["hip_hop", "country", "edm", "alternative_rock"];

export function isGenreAvailable(genre: GenreName): boolean {
  if (genre !== "alternative_rock") return true;
  const now = new Date();
  const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
  const cutoffMinutes = 22 * 60 + 30; // 10:30 PM
  const currentMinutes = mt.getHours() * 60 + mt.getMinutes();
  return currentMinutes < cutoffMinutes;
}

export function getAvailableGenres(): GenreName[] {
  return ALL_GENRES.filter(isGenreAvailable);
}

export function normalizeGenreVotes(event: EventRecord | null): { votes: GenreVotes; total: number } {
  const votes = {
    hip_hop: Number(event?.genreVotes?.hip_hop ?? 0),
    country: Number(event?.genreVotes?.country ?? 0),
    edm: Number(event?.genreVotes?.edm ?? 0),
    alternative_rock: Number(event?.genreVotes?.alternative_rock ?? 0),
  };
  const total = Number(event?.genreVotesTotal ?? votes.hip_hop + votes.country + votes.edm + votes.alternative_rock);
  return { votes, total };
}

export function buildGenreTickerItem(event: EventRecord | null): string | null {
  const { votes, total } = normalizeGenreVotes(event);
  if (total < GENRE_VOTE_THRESHOLD) {
    return null;
  }
  const genres = ALL_GENRES.filter((g) => votes[g] > 0);
  const parts = genres.map((genre) => {
    const percentage = Math.round((votes[genre] / total) * 100);
    return `${GENRE_LABELS[genre]} ${percentage}%`;
  });
  return `GENRE VOTES (${total}): ${parts.join(" • ")}`;
}
