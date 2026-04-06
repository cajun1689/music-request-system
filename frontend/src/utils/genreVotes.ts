import type { EventRecord, GenreName, GenreVotes } from "../types";

export const GENRE_VOTE_THRESHOLD = 15;

export const GENRE_LABELS: Record<GenreName, string> = {
  hip_hop: "Hip Hop",
  country: "Country",
  edm: "EDM",
};

export function normalizeGenreVotes(event: EventRecord | null): { votes: GenreVotes; total: number } {
  const votes = {
    hip_hop: Number(event?.genreVotes?.hip_hop ?? 0),
    country: Number(event?.genreVotes?.country ?? 0),
    edm: Number(event?.genreVotes?.edm ?? 0),
  };
  const total = Number(event?.genreVotesTotal ?? votes.hip_hop + votes.country + votes.edm);
  return { votes, total };
}

export function buildGenreTickerItem(event: EventRecord | null): string | null {
  const { votes, total } = normalizeGenreVotes(event);
  if (total < GENRE_VOTE_THRESHOLD) {
    return null;
  }
  const genres: GenreName[] = ["hip_hop", "country", "edm"];
  const parts = genres.map((genre) => {
    const percentage = Math.round((votes[genre] / total) * 100);
    return `${GENRE_LABELS[genre]} ${percentage}%`;
  });
  return `GENRE VOTES (${total}): ${parts.join(" • ")}`;
}
