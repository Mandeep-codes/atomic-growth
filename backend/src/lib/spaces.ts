import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { env } from "./env";

export const spacesClient = new S3Client({
  region: env.DO_SPACES_REGION,
  endpoint: env.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: env.DO_SPACES_ACCESS_KEY_ID,
    secretAccessKey: env.DO_SPACES_SECRET_ACCESS_KEY,
  },
});

export const getSpacesPublicUrl = (key: string) => {
  const sanitizedKey = key.replace(/^\/+/, "");
  if (env.DO_SPACES_PUBLIC_URL) {
    return `${env.DO_SPACES_PUBLIC_URL.replace(/\/$/, "")}/${sanitizedKey}`;
  }

  const endpointHost = new URL(env.DO_SPACES_ENDPOINT).host;
  return `https://${env.DO_SPACES_BUCKET}.${endpointHost}/${sanitizedKey}`;
};

const sanitizePathSegment = (value: string) =>
  value
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9_.-]/g, ""))
    .filter(Boolean)
    .join("/");

export const buildSpacesObjectKey = (
  fileName: string,
  folder?: string
) => {
  const safeFolder = folder ? sanitizePathSegment(folder) : undefined;
  const safeFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "");
  const uniqueId = randomUUID();

  if (safeFolder) return `${safeFolder}/${uniqueId}-${safeFileName}`;
  return `${uniqueId}-${safeFileName}`;
};

type SpacesAcl = "private" | "public-read";

export const uploadBufferToSpaces = async ({
  key,
  buffer,
  contentType,
  acl = "public-read",
}: {
  key: string;
  buffer: Buffer;
  contentType?: string;
  acl?: SpacesAcl;
}) => {
  await spacesClient.send(
    new PutObjectCommand({
      Bucket: env.DO_SPACES_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: acl,
    })
  );

  return {
    key,
    url: acl === "public-read" ? getSpacesPublicUrl(key) : null,
  };
};
