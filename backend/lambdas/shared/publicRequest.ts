export function toPublicRequest<T extends Record<string, unknown>>(request: T): Omit<
  T,
  | "organizationId"
  | "paymentReference"
  | "paymentVerifiedBy"
  | "stripePaymentAttemptId"
  | "requesterName"
  | "message"
  | "reviewedBy"
  | "shoutoutFlagReason"
  | "shoutoutFlagCategories"
  | "shoutoutFlagged"
  | "shoutoutFlagSeverity"
  | "shoutoutModeratedAt"
> {
  const {
    organizationId: _organizationId,
    paymentReference: _paymentReference,
    paymentVerifiedBy: _paymentVerifiedBy,
    stripePaymentAttemptId: _stripePaymentAttemptId,
    requesterName: _requesterName,
    message: _message,
    reviewedBy: _reviewedBy,
    shoutoutFlagReason: _shoutoutFlagReason,
    shoutoutFlagCategories: _shoutoutFlagCategories,
    shoutoutFlagged: _shoutoutFlagged,
    shoutoutFlagSeverity: _shoutoutFlagSeverity,
    shoutoutModeratedAt: _shoutoutModeratedAt,
    ...publicRequest
  } = request;
  if (publicRequest.shoutoutApproved !== true) {
    delete publicRequest.shoutout;
  }
  return publicRequest;
}
