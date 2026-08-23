import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { wise_recipient } from "../lib/schema";
import { protectedProcedure, router } from "../lib/trpc";
import { WiseApiError, wiseApi } from "../lib/wise";
import {
  buildWiseRecipientSummary,
  WiseRecipientSummary,
} from "../lib/wiseRecipientSummary";
import { WISE_NEPAL_BANKS } from "../shared/wiseNepalBanks";

const baseInputSchema = z.object({
  accountHolderName: z.string().min(1, "Account holder name is required"),
  addressFirstLine: z.string().min(1, "Address line is required"),
  addressCity: z.string().min(1, "City is required"),
  addressPostCode: z.string().min(3, "Postal code is required"),
});

const createWiseRecipientInput = z.discriminatedUnion("countryCode", [
  baseInputSchema.extend({
    countryCode: z.literal("IN"),
    accountNumber: z
      .string()
      .min(6, "Account number must be at least 6 digits"),
    ifscCode: z.string().min(4, "IFSC code is required"),
    legalType: z.enum(["PRIVATE", "BUSINESS"]).optional().default("PRIVATE"),
  }),
  baseInputSchema.extend({
    countryCode: z.literal("NP"),
    accountNumber: z
      .string()
      .min(9, "Account number must be at least 9 characters")
      .max(20, "Account number must be at most 20 characters"),
    bankCode: z
      .string()
      .refine(
        (value) => WISE_NEPAL_BANKS.some((bank) => bank.code === value),
        "Select a valid bank"
      ),
    legalType: z.literal("PRIVATE").optional().default("PRIVATE"),
  }),
  baseInputSchema.extend({
    countryCode: z.literal("PH"),
    accountNumber: z
      .string()
      .min(6, "Account number must be at least 6 digits")
      .max(18, "Account number must be at most 18 digits"),
    bankCode: z.string().min(1, "Select a bank"),
    legalType: z.literal("PRIVATE").optional().default("PRIVATE"),
  }),
]);

export const wiseRecipientsRouter = router({
  // Live list of Philippine banks + their Wise bank codes, for the PH bank
  // dropdown. Pulled from Wise's own account-requirements so codes are always
  // valid. Returns [] if Wise is unreachable — the form then falls back to a
  // free-text bank-code input.
  getPhilippinesBanks: protectedProcedure.query(async () => {
    try {
      const quote = await wiseApi.createQuote({
        sourceCurrency: "USD",
        targetCurrency: "PHP",
        sourceAmount: 100,
      });
      const requirements = await wiseApi.getAccountRequirements(
        String(quote.id)
      );
      const phType = requirements.find((r) => r.type === "philippines");
      const banks: { code: string; name: string }[] = [];
      for (const field of phType?.fields ?? []) {
        for (const g of field.group ?? []) {
          if (g.key === "bankCode" && Array.isArray(g.valuesAllowed)) {
            for (const v of g.valuesAllowed) {
              banks.push({ code: v.key, name: v.name });
            }
          }
        }
      }
      banks.sort((a, b) => a.name.localeCompare(b.name));
      return banks;
    } catch (error) {
      console.error("Failed to load Philippine bank list from Wise", error);
      return [] as { code: string; name: string }[];
    }
  }),

  getMine: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const record = await db.query.wise_recipient.findFirst({
      where: eq(wise_recipient.user_id, userId),
    });

    if (!record) {
      return null;
    }

    const summary = await fetchRecipientSummary(record.recipient_id);

    return {
      id: record.id,
      recipientId: record.recipient_id,
      summary,
    };
  }),

  create: protectedProcedure
    .input(createWiseRecipientInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const normalizedInput = normalizeCreateRecipientInput(input);

      if (!normalizedInput.accountHolderName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account holder name is required",
        });
      }

      try {
        const payload = buildWiseRecipientPayload(normalizedInput);
        const recipient = await wiseApi.createRecipient({
          profile: Number(env.WISE_PROFILE_ID),
          ...payload,
        });

        await db.transaction(async (tx) => {
          await tx
            .delete(wise_recipient)
            .where(eq(wise_recipient.user_id, userId));

          await tx.insert(wise_recipient).values({
            user_id: userId,
            recipient_id: String(recipient.id),
          });
        });

        const summary = await fetchRecipientSummary(String(recipient.id));

        return {
          id: String(recipient.id),
          recipientId: String(recipient.id),
          summary,
        };
      } catch (error) {
        let errorMessage =
          "Something went wrong. Please reach out to support on Discord.";
        try {
          if (error instanceof WiseApiError) {
            errorMessage = error.details?.response?.errors
              .map((error) => error.message)
              .join(" ");
          }
        } catch (error) {
          console.error("Failed to fetch Wise recipient details", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Something went wrong. Please reach out to support on Discord.",
          });
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage,
        });
      }
    }),

  delete: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;

    await db.delete(wise_recipient).where(eq(wise_recipient.user_id, userId));

    return { success: true };
  }),
});

async function fetchRecipientSummary(
  recipientId: string
): Promise<WiseRecipientSummary | null> {
  try {
    const account = await wiseApi.getAccount(recipientId);
    return buildWiseRecipientSummary(account);
  } catch (error) {
    if (error instanceof WiseApiError && error.status === 404) {
      return null;
    }
    console.error("Failed to fetch Wise recipient details", error);
    return null;
  }
}

type CreateRecipientInput = z.infer<typeof createWiseRecipientInput>;

type NormalizedRecipientInput = Omit<CreateRecipientInput, "legalType"> & {
  accountHolderName: string;
  addressFirstLine: string;
  addressCity: string;
  addressPostCode: string;
  accountNumber?: string;
  ifscCode?: string;
  bankCode?: string;
  legalType: "PRIVATE" | "BUSINESS";
};

function normalizeCreateRecipientInput(
  input: CreateRecipientInput
): NormalizedRecipientInput {
  const normalized: NormalizedRecipientInput = {
    ...input,
    accountHolderName: input.accountHolderName.trim(),
    addressFirstLine: input.addressFirstLine.trim(),
    addressCity: input.addressCity.trim(),
    addressPostCode: input.addressPostCode.trim(),
    legalType: input.legalType ?? "PRIVATE",
  };

  if ("accountNumber" in input) {
    normalized.accountNumber = input.accountNumber.replace(/\s+/g, "");
  }
  if ("ifscCode" in input) {
    normalized.ifscCode = input.ifscCode.trim().toUpperCase();
  }
  if ("bankCode" in input) {
    normalized.bankCode = input.bankCode;
  }

  return normalized;
}

function buildWiseRecipientPayload(input: NormalizedRecipientInput) {
  const address = {
    country: input.countryCode,
    city: input.addressCity,
    postCode: input.addressPostCode,
    firstLine: input.addressFirstLine,
  };

  switch (input.countryCode) {
    case "IN": {
      if (!input.accountNumber || !input.ifscCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account number and IFSC code are required for India",
        });
      }

      return {
        accountHolderName: input.accountHolderName,
        currency: "INR",
        type: "indian",
        legalType: input.legalType,
        details: {
          accountNumber: input.accountNumber,
          ifscCode: input.ifscCode,
          address,
        },
      } as const;
    }
    case "NP": {
      if (!input.accountNumber || !input.bankCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bank name and account number are required for Nepal",
        });
      }

      return {
        accountHolderName: input.accountHolderName,
        currency: "NPR",
        type: "nepal",
        legalType: "PRIVATE",
        details: {
          accountNumber: input.accountNumber,
          bankCode: input.bankCode,
          address,
        },
      } as const;
    }
    case "PH": {
      if (!input.accountNumber || !input.bankCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bank and account number are required for the Philippines",
        });
      }

      return {
        accountHolderName: input.accountHolderName,
        currency: "PHP",
        type: "philippines",
        legalType: "PRIVATE",
        details: {
          legalType: "PRIVATE",
          accountNumber: input.accountNumber,
          bankCode: input.bankCode,
          address,
        },
      } as const;
    }
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported country",
      });
  }
}
