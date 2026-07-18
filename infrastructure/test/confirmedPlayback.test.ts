import {
  buildAutoMatchUpdatePlan,
  buildRequestMatchUpdatePlan,
} from "../../backend/lambdas/shared/confirmedPlayback";

const now = "2026-07-18T07:00:00.000Z";

describe("confirmed playback update plans", () => {
  test("confirmed mixer playback marks the matched request played immediately", () => {
    const plan = buildRequestMatchUpdatePlan({
      playbackConfirmed: true,
      matchedWasPending: true,
      now,
      reviewedBy: "auto:booth-showkontrol:DJ",
    });

    expect(plan.resultingStatus).toBe("played");
    expect(plan.updateExpression).toContain("#status = :playedStatus");
    expect(plan.updateExpression).toContain("playedAt = :playedAt");
    expect(plan.expressionAttributeValues).toMatchObject({
      ":playedStatus": "played",
      ":playedAt": now,
      ":pendingStatus": "pending",
      ":approvedStatus": "approved",
    });
  });

  test("legacy pending matches are approved and remain deferred", () => {
    const requestPlan = buildRequestMatchUpdatePlan({
      playbackConfirmed: false,
      matchedWasPending: true,
      now,
      reviewedBy: "auto:rekordbox-push:DJ",
    });
    const autoMatchPlan = buildAutoMatchUpdatePlan({
      playbackConfirmed: false,
      sourceId: "rekordbox-push",
      trackNorm: "artist title",
      now,
      requestId: "request-1",
      reviewedBy: "auto:rekordbox-push:DJ",
    });

    expect(requestPlan.resultingStatus).toBe("approved");
    expect(requestPlan.updateExpression).toContain("#status = :approvedStatus");
    expect(requestPlan.updateExpression).not.toContain("playedAt");
    expect(autoMatchPlan.updateExpression).toContain("#ppri = :rid");
    expect(autoMatchPlan.expressionAttributeValues).toMatchObject({
      ":rid": "request-1",
      ":rb": "auto:rekordbox-push:DJ",
    });
  });

  test("confirmed playback clears stale deferred fields instead of creating them", () => {
    const plan = buildAutoMatchUpdatePlan({
      playbackConfirmed: true,
      sourceId: "booth-showkontrol",
      trackNorm: "artist title",
      now,
      requestId: "request-2",
      reviewedBy: "auto:booth-showkontrol:DJ",
    });

    expect(plan.updateExpression).toContain("REMOVE");
    expect(plan.updateExpression).toContain("#ppma");
    expect(plan.expressionAttributeValues).not.toHaveProperty(":rid");
    expect(plan.expressionAttributeValues).not.toHaveProperty(":rb");
  });
});
