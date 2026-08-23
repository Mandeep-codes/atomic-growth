import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { env } from "./env";

export class WiseApiError extends Error {
  status?: number;
  details?: any;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "WiseApiError";
    this.status = status;
    this.details = details;
  }
}

const wiseClient = axios.create({
  baseURL: env.WISE_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.WISE_API_TOKEN}`,
  },
  timeout: 30000,
});

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await wiseClient.request<T>(config);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      const message =
        error.response?.data?.message ||
        error.message ||
        "Unexpected Wise API error";
      throw new WiseApiError(message, error.response?.status, {
        url: error.config?.url,
        method: error.config?.method,
        data: error.config?.data,
        response: error.response?.data,
      });
    }

    throw error;
  }
}

const v3profileBase = `/v3/profiles/${env.WISE_PROFILE_ID}`;

export interface WiseBatchGroup {
  id: string;
  status: string;
  version?: number;
  transferIds?: Array<number | string>;
  payInDetails?: unknown[];
  [key: string]: unknown;
}

export interface WiseRecipient {
  id: number | string;
  [key: string]: unknown;
}

export interface WiseAccount {
  id: number | string;
  [key: string]: unknown;
}

export interface WiseTransfer {
  id: number | string;
  status: string;
  [key: string]: unknown;
}

export const wiseApi = {
  // Live recipient lookup. The local bank_accounts table is a stale snapshot
  // (it stopped being written to in Nov 2025) while clippers keep changing
  // their payout account in Wise, so the mod panel must read through to Wise
  // rather than trust the cached row.
  getRecipientAccount(accountId: string | number) {
    return request<{
      id: number;
      accountHolderName?: string | null;
      currency?: string | null;
      country?: string | null;
      type?: string | null;
      details?: Record<string, unknown> | null;
    }>({
      method: "GET",
      url: `/v1/accounts/${accountId}`,
    });
  },

  createBatchGroup(payload: { sourceCurrency: string; name: string }) {
    return request<WiseBatchGroup>({
      method: "POST",
      url: `${v3profileBase}/batch-groups`,
      data: payload,
    });
  },

  completeBatchGroup(batchGroupId: string, version: number) {
    return request<WiseBatchGroup>({
      method: "PATCH",
      url: `${v3profileBase}/batch-groups/${batchGroupId}`,
      data: {
        status: "COMPLETED",
        version,
      },
    });
  },

  cancelBatchGroup(batchGroupId: string) {
    return request<WiseBatchGroup>({
      method: "PATCH",
      url: `${v3profileBase}/batch-groups/${batchGroupId}`,
      data: {
        status: "CANCELLED",
      },
    });
  },

  getBatchGroup(batchGroupId: string) {
    return request<WiseBatchGroup>({
      method: "GET",
      url: `${v3profileBase}/batch-groups/${batchGroupId}`,
    });
  },

  createBatchTransfer(batchGroupId: string, payload: Record<string, unknown>) {
    return request<Record<string, unknown>>({
      method: "POST",
      url: `${v3profileBase}/batch-groups/${batchGroupId}/transfers`,
      data: payload,
    });
  },

  fundBatchGroup(batchGroupId: string) {
    return request<WiseBatchGroup>({
      method: "POST",
      url: `${v3profileBase}/batch-payments/${batchGroupId}/payments`,
      data: {
        type: "BALANCE",
      },
    });
  },

  createQuote(payload: {
    sourceCurrency: string;
    targetCurrency: string;
    sourceAmount?: number;
    targetAmount?: number;
    payOut?: string;
    preferredPayIn?: string;
  }) {
    if (
      typeof payload.sourceAmount !== "number" &&
      typeof payload.targetAmount !== "number"
    ) {
      throw new WiseApiError(
        "Wise quote requires either sourceAmount or targetAmount",
        400
      );
    }

    return request<Record<string, any>>({
      method: "POST",
      url: `${v3profileBase}/quotes`,
      data: {
        payOut: "BANK_TRANSFER",
        preferredPayIn: "BALANCE",
        ...payload,
      },
    });
  },

  createRecipient(payload: Record<string, unknown>) {
    return request<WiseRecipient>({
      method: "POST",
      url: "/v1/accounts",
      data: payload,
    });
  },

  // Wise's dynamic account requirements for a quote — the authoritative list of
  // recipient types + fields (incl. each field's allowed values, e.g. the valid
  // bank codes for PHP). We read the "philippines" type's bankCode valuesAllowed
  // from this to populate the Philippines bank dropdown.
  getAccountRequirements(quoteId: string | number) {
    return request<
      Array<{
        type: string;
        fields?: Array<{
          group?: Array<{
            key?: string;
            name?: string;
            valuesAllowed?: Array<{ key: string; name: string }> | null;
          }>;
        }>;
      }>
    >({
      method: "GET",
      url: `/v1/quotes/${quoteId}/account-requirements`,
      headers: { "Accept-Minor-Version": "1" },
    });
  },

  getAccount(accountId: string | number) {
    return request<WiseAccount>({
      method: "GET",
      url: `/v2/accounts/${accountId}`,
    });
  },

  getTransfer(transferId: string | number) {
    return request<WiseTransfer>({
      method: "GET",
      url: `/v1/transfers/${transferId}`,
    });
  },
};
