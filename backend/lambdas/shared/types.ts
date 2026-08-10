export type RequestStatus = "pending" | "approved" | "vetoed" | "played" | "archived";
export type PaymentStatus = "unpaid" | "pending_verification" | "verified" | "rejected";
export type GenreName = "hip_hop" | "country" | "edm" | "alternative_rock";
export type AccountMode = "legacy" | "saas";
export type OrganizationRole = "owner" | "admin" | "dj";
export type SaasPlanId = "dj" | "organization";
export type SubscriptionStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid";

export interface OrganizationEntitlements {
  maxActiveEvents: number;
  maxMembers: number;
  maxBridgeDevices: number;
  maxLibraryTracks: number;
  maxWebsocketConnections: number;
  retentionDays: number;
  monthlyAiRequests: number;
}

export interface OrganizationBranding {
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export interface OrganizationDefaults {
  djBrandName?: string;
  venueName?: string;
}

export interface OrganizationRecord {
  organizationId: string;
  slug: string;
  name: string;
  accountMode: AccountMode;
  accountStatus?: "active" | "suspended" | "deletion_pending";
  ownerUserId: string;
  memberCount?: number;
  branding: OrganizationBranding;
  defaults: OrganizationDefaults;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionEventCreatedAt?: number;
  stripeConnectedAccountId?: string;
  stripeConnectDetailsSubmitted?: boolean;
  stripeConnectChargesEnabled?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
  stripeConnectEventCreatedAt?: number;
  subscriptionStatus?: SubscriptionStatus;
  planId?: SaasPlanId | "legacy";
  trialEndsAt?: string;
  gracePeriodEndsAt?: string;
  deletionRequestedAt?: string;
  deletionScheduledAt?: string;
  entitlements: OrganizationEntitlements;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMembershipRecord {
  organizationId: string;
  userId: string;
  email: string;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationInvitationRecord {
  invitationId: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  invitedBy: string;
  expiresAt: number;
  acceptedAt?: string;
  createdAt: string;
}

export interface BridgeDeviceRecord {
  deviceId: string;
  organizationId: string;
  eventId: string;
  sourceId: string;
  name: string;
  tokenHash: string;
  status: "active" | "revoked";
  lastSeenAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
  organizationId?: string;
  accountMode?: AccountMode;
  createdBy?: string;
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
  organizationId?: string;
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
  paymentStatus: PaymentStatus;
  tipAmount?: number;
  venmoHandle?: string;
  paymentReference?: string;
  stripePaymentAttemptId?: string;
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
