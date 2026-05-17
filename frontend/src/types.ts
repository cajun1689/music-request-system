export type RequestStatus = "pending" | "approved" | "vetoed" | "played" | "archived";
export type PaymentStatus = "unpaid" | "pending_verification" | "verified" | "rejected";
export type GenreName = "hip_hop" | "country" | "edm" | "alternative_rock";

export interface GenreVotes {
  hip_hop: number;
  country: number;
  edm: number;
  alternative_rock: number;
}

export interface NowPlayingSlot {
  id: string;
  djName: string;
  songTitle: string;
  artistName?: string;
  active: boolean;
  updatedAt?: string;
}

export interface LivePlaylistSource {
  id: string;
  name: string;
  djName?: string;
  type: "serato" | "rekordbox";
  url: string;
  active: boolean;
}

export interface AutoMatchSourceState {
  lastPushedTrackNorm?: string;
  lastMatchedTrackNorm?: string;
  lastMatchedAt?: string;
  pendingPlayedRequestId?: string;
  pendingPlayedReviewedBy?: string;
}

export interface EventRecord {
  eventId: string;
  name: string;
  slug?: string;
  isRecurring?: boolean;
  date: string;
  venueName: string;
  venueLogoUrl?: string;
  djBrandName: string;
  djLogoUrl?: string;
  seratoLiveUrl?: string;
  rekordboxLiveUrl?: string;
  livePlaylistSources?: LivePlaylistSource[];
  autoMatchState?: Record<string, AutoMatchSourceState>;
  tickerPromotions?: string[];
  fireSaleActive?: boolean;
  fireSaleMessage?: string;
  venmoHandle?: string;
  pushToken?: string;
  genreVotes?: GenreVotes;
  genreVotesTotal?: number;
  nowPlayingSlots?: NowPlayingSlot[];
  nowPlayingAutoEnabled?: boolean;
  nowPlayingOnTicker?: boolean;
  autoApproveList?: string[];
  blockList?: string[];
  blockedPushSources?: string[];
  libraryOnlyMode?: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequestRecord {
  eventId: string;
  requestId: string;
  songTitle: string;
  artistName: string;
  requesterName?: string;
  message?: string;
  shoutout?: string;
  shoutoutApproved?: boolean;
  shoutoutApprovedAt?: string;
  shoutoutFlagged?: boolean;
  shoutoutFlagSeverity?: "ok" | "warn" | "block";
  shoutoutFlagCategories?: string[];
  shoutoutFlagReason?: string;
  shoutoutModeratedAt?: string;
  status: RequestStatus;
  paymentStatus?: PaymentStatus;
  tipAmount?: number;
  venmoHandle?: string;
  paymentReference?: string;
  paymentVerifiedBy?: string;
  paidAt?: string;
  position?: number;
  upvotes?: number;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  playedAt?: string;
  previousStatus?: string;
  archivedAt?: string;
}

export interface Session {
  email: string;
  idToken: string;
}
