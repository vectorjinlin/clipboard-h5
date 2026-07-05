export interface WalletDetectionResult {
  isWalletAddress: boolean;
  validFormat: boolean;
  checksumValid: boolean | null;
  primaryType?: string;
  chainCandidates: string[];
  normalizedAddress?: string;
  network?: "mainnet" | "testnet" | "unknown";
  addressType?: string;
  confidence: number;
  requiresNetworkContext: boolean;
  requiresOnChainCheck: boolean;
  warnings: string[];
}

export function detectWalletAddress(input: string): WalletDetectionResult;
export function validateEvmAddress(input: string): WalletDetectionResult | null;
export function validateBitcoinAddress(input: string): WalletDetectionResult | null;
export function validateTronAddress(input: string): WalletDetectionResult | null;
export function validateSolanaAddress(input: string): WalletDetectionResult | null;
export function validateAptosAddress(input: string): WalletDetectionResult | null;
export function validateSuiAddress(input: string): WalletDetectionResult | null;
export function validateCosmosAddress(input: string): WalletDetectionResult | null;
export function validateTonAddress(input: string): WalletDetectionResult | null;
export function validateXrpAddress(input: string): WalletDetectionResult | null;
export function validateSubstrateAddress(input: string): WalletDetectionResult | null;
export function validateCardanoAddress(input: string): WalletDetectionResult | null;
