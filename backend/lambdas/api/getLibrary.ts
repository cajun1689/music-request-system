import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { env, json } from "../shared/utils";

const s3 = new S3Client({});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) return json(400, { error: "eventId is required" });

  const key = `libraries/${eventId}.json`;

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: env.brandAssetsBucketName,
        Key: key,
      }),
    );

    const body = await response.Body?.transformToString();
    if (!body) return json(404, { error: "No library found" });

    const data = JSON.parse(body);
    return json(200, data);
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchKey") {
      return json(404, { error: "No library synced for this event" });
    }
    throw err;
  }
};
