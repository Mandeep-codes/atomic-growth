import { router, protectedProcedure } from "../lib/trpc";
import { db } from "../lib/db";
import { bank_accounts } from "../lib/schema";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Input validation schema for bank account
const bankAccountSchema = z.object({
  bank_name: z.string().optional(),
  account_number: z.string().optional(),
  ifsc_code: z.string().optional(),
  account_holder: z.string().optional(),
  branch_name: z.string().optional(),
  name: z.string().optional(),
  recipient_email: z.string().email().optional(),
  receiver_type: z.string().optional(),
  amount_currency: z.string().optional(),
  source_currency: z.string().optional(),
  target_currency: z.string().optional(),
  address_country_code: z.string().optional(),
  address_city: z.string().optional(),
  address_first_line: z.string().optional(),
  address_post_code: z.string().optional(),
});

export const bankAccountsRouter = router({
  // Get all bank accounts for the current user
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const accounts = await db
      .select()
      .from(bank_accounts)
      .where(eq(bank_accounts.user_id, userId))
      .orderBy(desc(bank_accounts.created_at));

    return accounts;
  }),

  // Get a specific bank account by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const account = await db
        .select()
        .from(bank_accounts)
        .where(
          and(eq(bank_accounts.id, input.id), eq(bank_accounts.user_id, userId))
        )
        .limit(1);

      if (!account || account.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bank account not found",
        });
      }

      return account[0];
    }),

  // Create a new bank account
  create: protectedProcedure
    .input(bankAccountSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [newAccount] = await db.insert(bank_accounts).values({
        user_id: userId,
        bank_name: input.bank_name,
        account_number: input.account_number,
        ifsc_code: input.ifsc_code,
        account_holder: input.account_holder,
        branch_name: input.branch_name,
        name: input.account_holder,
        recipient_email: input.recipient_email,
        receiver_type: input.receiver_type,
        amount_currency: input.amount_currency,
        source_currency: input.source_currency,
        target_currency: input.target_currency,
        address_country_code: input.address_country_code,
        address_city: input.address_city,
        address_first_line: input.address_first_line,
        address_post_code: input.address_post_code,
      });

      return {
        success: true,
        message: "Bank account created successfully",
        accountId: newAccount.insertId,
      };
    }),

  // Update an existing bank account
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: bankAccountSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify the bank account belongs to the user
      const existingAccount = await db
        .select()
        .from(bank_accounts)
        .where(
          and(eq(bank_accounts.id, input.id), eq(bank_accounts.user_id, userId))
        )
        .limit(1);

      if (!existingAccount || existingAccount.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bank account not found",
        });
      }

      await db
        .update(bank_accounts)
        .set({
          bank_name: input.data.bank_name,
          account_number: input.data.account_number,
          ifsc_code: input.data.ifsc_code,
          account_holder: input.data.account_holder,
          branch_name: input.data.branch_name,
          name: input.data.name,
          recipient_email: input.data.recipient_email,
          receiver_type: input.data.receiver_type,
          amount_currency: input.data.amount_currency,
          source_currency: input.data.source_currency,
          target_currency: input.data.target_currency,
          address_country_code: input.data.address_country_code,
          address_city: input.data.address_city,
          address_first_line: input.data.address_first_line,
          address_post_code: input.data.address_post_code,
        })
        .where(eq(bank_accounts.id, input.id));

      return {
        success: true,
        message: "Bank account updated successfully",
      };
    }),

  // Delete a bank account
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify the bank account belongs to the user
      const existingAccount = await db
        .select()
        .from(bank_accounts)
        .where(
          and(eq(bank_accounts.id, input.id), eq(bank_accounts.user_id, userId))
        )
        .limit(1);

      if (!existingAccount || existingAccount.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bank account not found",
        });
      }

      await db.delete(bank_accounts).where(eq(bank_accounts.id, input.id));

      return {
        success: true,
        message: "Bank account deleted successfully",
      };
    }),
});
