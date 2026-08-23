import { PutObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";
import { z } from "zod";

import { protectedProcedure, router } from "../lib/trpc";
import { env } from "../lib/env";
import { getSpacesPublicUrl, spacesClient } from "../lib/spaces";
import { llmCall } from "../lib/openai";
import { demographicSchema } from "../lib/zod-schemas/demographic";

const uploadInput = z.object({
  fileName: z.string().min(1, "fileName is required"),
  fileType: z.string().min(1, "fileType is required"),
  fileBase64: z.string().min(1, "fileBase64 is required"),
  folder: z.string().optional(),
});

const sanitizePathSegment = (value: string) =>
  value
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9_.-]/g, ""))
    .filter(Boolean)
    .join("/");

const buildObjectKey = (folder: string | undefined, fileName: string) => {
  const safeFolder = folder ? sanitizePathSegment(folder) : undefined;
  const safeFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "");
  const uniqueId = randomUUID();

  if (safeFolder) return `${safeFolder}/${uniqueId}-${safeFileName}`;
  return `${uniqueId}-${safeFileName}`;
};

export const uploadsRouter = router({
  uploadDemographicScreenshot: protectedProcedure
    .input(uploadInput)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const fileBuffer = Buffer.from(input.fileBase64, "base64");

      if (!fileBuffer.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "File payload is empty",
        });
      }

      const key = buildObjectKey(input.folder, input.fileName);

      try {
        await spacesClient.send(
          new PutObjectCommand({
            Bucket: env.DO_SPACES_BUCKET,
            Key: key,
            Body: fileBuffer,
            ContentType: input.fileType,
            ACL: "public-read",
          })
        );
      } catch (error) {
        console.error("Failed to upload file to Spaces", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to upload file",
        });
      }

      const url = getSpacesPublicUrl(key);

      const llmResponse = await llmCall(url);

      const llmContent = llmResponse.choices[0]?.message.content;
      console.debug("LLM Response:", llmContent);

      if (!llmContent) {
        console.error("failed to get LLM content");
        return {
          success: false,
          screenshotUrl: url,
        };
      }

      const parsedContent = demographicSchema.safeParse({
        version: "v1",
        ...JSON.parse(llmContent),
      });

      if (!parsedContent.success) {
        console.log("Failed to parse LLM content", parsedContent.error);
        return {
          success: false,
          screenshotUrl: url,
        };
      }

      if (parsedContent.data.countries.length === 0) {
        return {
          success: false,
          screenshotUrl: url,
        };
      }

      return {
        success: true,
        screenshotUrl: url,
        demographics: parsedContent.data,
      };
    }),
});
