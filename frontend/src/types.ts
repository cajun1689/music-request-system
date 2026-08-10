export type RequestStatus = "pending" | "approved" | "vetoed" | "played" | "archived";
export type PaymentStatus = "unpaid" | "pending_verification" | "verified" | "rejected";
export type GenreName = "hip_hop" | "country" | "edm" | "alternative_rock";
export type AccountMode = "legacy" | "saas";
export type OrganizationRole = "owner" | "admin" | "dj";
export type SaasPlanId = "dj" | "organization";
export type SubscriptionStatus =
  | "inactive"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired";
export type ConnectStatus = "not_started" | "pending" | "restricted" | "active";

export interface Organization {
  organizationId: string;
  name: string;
  slug: string;
  subscriptionStatus?: SubscriptionStatus;
  billingStatus?: SubscriptionStatus;
  accountMode?: AccountMode;
  accountStatus?: "active" | "suspended" | "deletion_pending";
  planId?: SaasPlanId | "legacy";
  plan?: string;
  entitlements?: {
    maxActiveEvents: number;
    maxMembers: number;
    maxBridgeDevices: number;
    maxLibraryTracks: number;
    maxWebsocketConnections: number;
    retentionDays: number;
    monthlyAiRequests: number;
  };
  branding?: {
    logoUrl?: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
  defaults?: {
    djBrandName?: string;
    venueName?: string;
  };
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeConnectedAccountId?: string;
  stripeConnectAccountId?: string;
  stripeConnectDetailsSubmitted?: boolean;
  stripeConnectChargesEnabled?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
  stripeConnectStatus?: ConnectStatus;
  connectStatus?: ConnectStatus;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Membership {
  organizationId: string;
  userId?: string;
  email?: string;
  role: OrganizationRole;
  status?: "active" | "invited";
  organization?: Organization;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrganizationInvitation {
  invitationId?: string;
  organizationId: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  token?: string;
  status?: "pending" | "accepted" | "expired" | "revoked";
  inviteUrl?: string;
  expiresAt?: string | number;
  createdAt?: string;
}

export interface BridgeDevice {
  deviceId: string;
  organizationId: string;
  eventId: string;
  sourceId: string;
  name: string;
  status: "active" | "revoked";
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StripeConnectStatus {
  status?: ConnectStatus;
  connectStatus?: ConnectStatus;
  stripeConnectStatus?: ConnectStatus;
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  requirementsDue?: string[];
}

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
  lastPushedAt?: string;
  lastMatchedTrackNorm?: string;
  lastMatchedAt?: string;
  pendingPlayedRequestId?: string;
  pendingPlayedReviewedBy?: string;
  pendingPlayedMatchedAt?: string;
}

export interface TickerPromotion {
  text: string;
  active: boolean;
}

export interface EventRecord {
  eventId: string;
  accountMode?: AccountMode;
  organizationId?: string;
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
  tickerPromotions?: Array<string | TickerPromotion>;
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
  genre?: GenreName;
  genreLabel?: string;
  status: RequestStatus;
  paymentStatus?: PaymentStatus;
  tipAmount?: number;
  venmoHandle?: string;
  paymentReference?: string;
  paymentFailureReason?: "failed" | "refunded";
  paymentUpdatedAt?: string;
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
