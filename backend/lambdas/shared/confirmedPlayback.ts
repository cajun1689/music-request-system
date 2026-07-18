export interface RequestMatchUpdatePlan {
  conditionExpression: string;
  updateExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
  resultingStatus: "approved" | "played";
}

export interface AutoMatchUpdatePlan {
  updateExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
}

export function buildRequestMatchUpdatePlan(input: {
  playbackConfirmed: boolean;
  matchedWasPending: boolean;
  now: string;
  reviewedBy: string;
}): RequestMatchUpdatePlan {
  const {
    playbackConfirmed,
    matchedWasPending,
    now,
    reviewedBy,
  } = input;

  return {
    conditionExpression:
      "attribute_exists(eventId) and attribute_exists(requestId) "
      + "and (#status = :pendingStatus or #status = :approvedStatus)",
    updateExpression: playbackConfirmed
      ? "SET reviewedAt = :reviewedAt, reviewedBy = :reviewedBy, "
        + "#status = :playedStatus, playedAt = :playedAt"
      : matchedWasPending
        ? "SET reviewedAt = :reviewedAt, reviewedBy = :reviewedBy, "
          + "#status = :approvedStatus"
        : "SET reviewedAt = :reviewedAt, reviewedBy = :reviewedBy",
    expressionAttributeNames: { "#status": "status" },
    expressionAttributeValues: {
      ":reviewedAt": now,
      ":reviewedBy": reviewedBy,
      ":pendingStatus": "pending",
      ":approvedStatus": "approved",
      ...(playbackConfirmed ? { ":playedStatus": "played", ":playedAt": now } : {}),
    },
    resultingStatus: playbackConfirmed ? "played" : "approved",
  };
}

export function buildAutoMatchUpdatePlan(input: {
  playbackConfirmed: boolean;
  sourceId: string;
  trackNorm: string;
  now: string;
  requestId: string;
  reviewedBy: string;
}): AutoMatchUpdatePlan {
  const {
    playbackConfirmed,
    sourceId,
    trackNorm,
    now,
    requestId,
    reviewedBy,
  } = input;

  return {
    updateExpression: playbackConfirmed
      ? "SET #ams.#sid.#lmtn = :tn, #ams.#sid.#lma = :now "
        + "REMOVE #ams.#sid.#ppri, #ams.#sid.#pprb, #ams.#sid.#ppma"
      : "SET #ams.#sid.#lmtn = :tn, #ams.#sid.#lma = :now, "
        + "#ams.#sid.#ppri = :rid, #ams.#sid.#pprb = :rb, #ams.#sid.#ppma = :now",
    expressionAttributeNames: {
      "#ams": "autoMatchState",
      "#sid": sourceId,
      "#lmtn": "lastMatchedTrackNorm",
      "#lma": "lastMatchedAt",
      "#ppri": "pendingPlayedRequestId",
      "#pprb": "pendingPlayedReviewedBy",
      "#ppma": "pendingPlayedMatchedAt",
    },
    expressionAttributeValues: {
      ":tn": trackNorm,
      ":now": now,
      ...(!playbackConfirmed ? { ":rid": requestId, ":rb": reviewedBy } : {}),
    },
  };
}
