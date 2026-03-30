import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { env, json, parseBody } from "../shared/utils";

const s3Client = new S3Client({});

interface UploadInput {
  contentType: string;
  extension?: string;
  fileBase64?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const input = parseBody<UploadInput>(event.body);
  if (!eventId || !input?.contentType) {
    return json(400, { error: "eventId and contentType are required" });
  }

  const extension = input.extension?.replace(/[^a-zA-Z0-9]/g, "") || "png";
  const key = `events/${eventId}/${randomUUID()}.${extension}`;
  const assetUrl = `https://${env.brandAssetsBucketName}.s3.amazonaws.com/${key}`;

  if (input.fileBase64) {
    const body = Buffer.from(input.fileBase64, "base64");
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.brandAssetsBucketName,
        Key: key,
        ContentType: input.contentType,
        Body: body,
      }),
    );

    return json(200, {
      assetUrl,
      key,
      uploadedVia: "api",
    });
  }

  const command = new PutObjectCommand({
    Bucket: env.brandAssetsBucketName,
    Key: key,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 60 * 5,
  });

  return json(200, {
    uploadUrl,
    assetUrl,
    key,
    uploadedVia: "presigned",
  });
};
