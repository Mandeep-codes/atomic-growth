import type { WiseAccount } from "./wise";

export interface WiseRecipientSummary {
  accountHolderName: string | null;
  bankName: string | null;
  routingCodeLabel: string | null;
  routingCodeValue: string | null;
  last4: string | null;
  currency: string | null;
  accountNumber: string | null;
  iban: string | null;
  addressFirstLine: string | null;
  addressCity: string | null;
  addressPostCode: string | null;
  addressCountry: string | null;
  legalType: "PRIVATE" | "BUSINESS" | null;
}

export function buildWiseRecipientSummary(
  account: WiseAccount | null | undefined
): WiseRecipientSummary | null {
  if (!account) {
    return null;
  }

  const accountNumber = extractAccountNumber(account);
  const { routingCodeLabel, routingCodeValue } = extractRoutingCode(account);
  return {
    accountHolderName: extractString(account, ["name", "fullName"]),
    bankName: extractString(account, ["additionalDisplayDetails", "bankNameLongSummary"]),
    routingCodeLabel,
    routingCodeValue,
    last4: accountNumber ? accountNumber.slice(-4) : null,
    currency: typeof account.currency === "string" ? account.currency : null,
    accountNumber,
    iban: extractString(account, ["details", "IBAN"]),
    addressFirstLine: extractString(account, ["address", "firstLine"]),
    addressCity: extractString(account, ["address", "city"]),
    addressPostCode: extractString(account, ["address", "postCode"]),
    addressCountry: extractString(account, ["address", "country"]),
    legalType: normalizeLegalType(extractString(account, ["legalType"])),
  };
}

function normalizeLegalType(
  value: string | null
): "PRIVATE" | "BUSINESS" | null {
  if (!value) {
    return null;
  }
  if (value.toUpperCase() === "BUSINESS") {
    return "BUSINESS";
  }
  if (value.toUpperCase() === "PRIVATE") {
    return "PRIVATE";
  }
  return null;
}

function extractAccountNumber(account: WiseAccount): string | null {
  const raw =
    extractString(account, ["details", "accountNumber"]) ??
    extractString(account, ["details", "IBAN"]);
  if (!raw) {
    return null;
  }
  return raw.replace(/\s+/g, "");
}

function extractRoutingCode(
  account: WiseAccount
): { routingCodeLabel: string | null; routingCodeValue: string | null } {
  const ifsc = extractString(account, ["details", "ifscCode"]);
  if (ifsc) {
    return { routingCodeLabel: "IFSC code", routingCodeValue: ifsc };
  }

  const bankCode = extractString(account, ["details", "bankCode"]);
  if (bankCode) {
    return { routingCodeLabel: "Bank code", routingCodeValue: bankCode };
  }

  const bic = extractString(account, ["details", "BIC"]);
  if (bic) {
    return { routingCodeLabel: "BIC/SWIFT", routingCodeValue: bic };
  }

  return { routingCodeLabel: null, routingCodeValue: null };
}

function extractString(
  target: unknown,
  path: Array<string>
): string | null {
  if (!target || typeof target !== "object") {
    return null;
  }

  let current: any = target;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = current[key];
  }

  return typeof current === "string" && current.trim() !== ""
    ? current
    : null;
}
