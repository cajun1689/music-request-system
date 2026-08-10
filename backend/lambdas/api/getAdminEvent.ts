import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireEventAccess, authorizationResponse } from "../shared/tenancy";
import { json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const eventId = event.pathParameters?.eventId;
    if (!eventId) return json(400, { error: "eventId is required" });
    const { eventRecord } = await requireEventAccess(event, eventId);
    return json(200, eventRecord);
  } catch (error) {
    return authorizationResponse(error);
  }
};
