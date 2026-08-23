// Allowed crypto payout destinations, keyed by NOWPayments ticker.
// Mirrored at frontend/src/shared/cryptoPayoutOptions.ts — keep in sync.
//
// Deliberately EXCLUDED:
//  - usdterc20 / anything on Ethereum mainnet and usdttrc20 (Tron): network
//    fees run $1-15 per transfer vs cents on the networks below.
//  - Non-stablecoin assets (BTC/ETH/SOL native): withdrawal amounts are sent
//    to NOWPayments 1:1 from the clipper's USD balance, so a volatile asset
//    would need an FX conversion step that deliberately doesn't exist.
//
// NOTE: a ticker must exist in NOWPayments' GET /v1/currencies for our
// account — verify there before adding a new entry here.
export interface CryptoPayoutOption {
  /** NOWPayments currency ticker sent in the payout API call */
  npCurrency: string;
  asset: "USDT" | "USDC";
  network: string;
}

export const CRYPTO_PAYOUT_OPTIONS: CryptoPayoutOption[] = [
  { npCurrency: "usdtbsc", asset: "USDT", network: "BNB Smart Chain (BEP-20)" },
  { npCurrency: "usdtsol", asset: "USDT", network: "Solana" },
  { npCurrency: "usdtmatic", asset: "USDT", network: "Polygon" },
  { npCurrency: "usdtton", asset: "USDT", network: "TON" },
  { npCurrency: "usdcbsc", asset: "USDC", network: "BNB Smart Chain (BEP-20)" },
  { npCurrency: "usdcsol", asset: "USDC", network: "Solana" },
  { npCurrency: "usdcmatic", asset: "USDC", network: "Polygon" },
  { npCurrency: "usdcbase", asset: "USDC", network: "Base" },
];

export const CRYPTO_PAYOUT_OPTION_BY_CURRENCY = new Map(
  CRYPTO_PAYOUT_OPTIONS.map((option) => [option.npCurrency, option])
);

export const isAllowedCryptoCurrency = (npCurrency: string): boolean =>
  CRYPTO_PAYOUT_OPTION_BY_CURRENCY.has(npCurrency);
