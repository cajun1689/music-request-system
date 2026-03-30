export type RequestStatus = "pending" | "approved" | "vetoed" | "played";
export type PaymentStatus = "unpaid" | "pending_verification" | "verified" | "rejected";

export interface NowPlayingSlot {
  id: string;
  djName: string;
  songTitle: string;
  artistName?: string;
  active: boolean;
  updatedAt?: string;
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
  venmoHandle?: string;
  nowPlayingSlots?: NowPlayingSlot[];
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
  status: RequestStatus;
  paymentStatus: PaymentStatus;
  tipAmount?: number;
  venmoHandle?: string;
  paymentReference?: string;
  paymentVerifiedBy?: string;
  paidAt?: string;
  position?: number;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  playedAt?: string;
}
