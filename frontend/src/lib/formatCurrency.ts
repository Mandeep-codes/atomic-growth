export type FormatCurrencyOptions = {
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

export const formatCurrency = (
  value: number | null | undefined,
  options: FormatCurrencyOptions = {}
) => {
  const amount = value ?? 0;
  const defaultFractionDigits = amount >= 1000 ? 0 : 2;
  const {
    currency = "USD",
    minimumFractionDigits = defaultFractionDigits,
    maximumFractionDigits = defaultFractionDigits,
  } = options;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
};
