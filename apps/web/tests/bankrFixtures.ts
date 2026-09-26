/**
 * Bankr and Robinhood Chain as the tests see them: answers shaped like the
 * real ones, trimmed. Nothing here reaches either.
 */

export const KEY = "bk_usr_k1a2b3c4_" + "s".repeat(32);
export const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
export const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export const BNKR = "0x178E54df3D091EE4D0B2534742eF9e3692b76526";
export const WALLET = "0x6732c0829808e8286012f53462013104289025b4";
export const BANKR_WALLET = "0x47bf9cca6875610364cf6e84e48b2e178fd32af0";
export const TOKEN = "0x89b45a9f2f67f7a302a085b40bcef2093e3c8ba3";
export const POOL = "0x5c152d7eb645312ca3d5a0c334fd700392f2044f74d70f526382be3c69fca31e";
export const TX = "0x97d168916d1a43143b7e3e5f61f5ecf6f7ae448fbd94b458076d32a5718cdeaa";

export const QUOTES = {
  chain: "robinhood",
  provider: "doppler",
  quoteTokens: [
    { address: WETH, symbol: "WETH", name: "Wrapped Ether", kind: "major", isDefault: true, deployField: null },
    { address: BNKR, symbol: "BNKR", name: "BankrCoin", kind: "project", isDefault: false, deployField: "pairedTokenAddress", readiness: "live" },
    { address: NVDA, symbol: "NVDA", name: "NVIDIA", kind: "stock", isDefault: false, deployField: "pairedStockAddress", illiquid: false },
    { address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", symbol: "TSLA", name: "Tesla", kind: "stock", deployField: "pairedStockAddress", illiquid: null },
    { address: "0x7c04E6A3368F2A1DE3874f0e80d2e0A1a9915da6", symbol: "GLW", name: "Corning", kind: "stock", deployField: "pairedStockAddress", illiquid: true },
    { address: "0x91A2DAe9699f0B82540B5886b0d8759C22820bA3", symbol: "musebook", name: "musebook", kind: "project", deployField: "pairedTokenAddress", readiness: "pending" },
    { address: "0x1111111111111111111111111111111111111111", symbol: "V3ONLY", name: "Other", kind: "stock", deployField: "launchV3.quoteAddress" },
    { address: "not-an-address", symbol: "BAD", name: "Bad", kind: "stock", deployField: "pairedStockAddress" },
  ],
};

export const LAUNCH = {
  status: "deployed",
  launchType: "doppler",
  tokenName: "Decentralized Accelerationism",
  tokenSymbol: "d/acc",
  chain: "robinhood",
  tokenAddress: TOKEN,
  poolId: POOL,
  txHash: TX,
  deployer: { walletAddress: BANKR_WALLET, xUsername: "someone" },
  feeRecipient: { walletAddress: WALLET },
  timestamp: 1790425806761,
  pairedStock: { address: NVDA.toLowerCase(), symbol: "NVDA" },
  unclaimedFees: { tokenAmount: "12338660.549625", tokenSymbol: "d/acc", wethAmount: "0.009774", numeraireSymbol: "NVDA", usdValue: 1.4642932478288715 },
};

export const ME = {
  success: true,
  wallets: [
    { chain: "evm", address: "0x47BF9CCA6875610364CF6E84E48B2E178FD32AF0" },
    { chain: "solana", address: "5DcK" },
  ],
  socialAccounts: [{ platform: "twitter", username: "someone" }],
  bankrClub: { active: false },
};

/** One creator-fees answer for a beneficiary, with the launch above on Robinhood Chain. */
export const FEES = {
  address: WALLET,
  tokens: [
    {
      tokenAddress: TOKEN,
      name: "Decentralized Accelerationism",
      symbol: "d/acc",
      poolId: POOL,
      share: "95.00%",
      token0Label: "d/acc",
      token1Label: "NVDA",
      claimable: { token0: "12338660.549625", token1: "0.009774" },
      claimed: { token0: "0.000000", token1: "0.000000", count: 0 },
      source: "doppler",
      chain: "robinhood",
    },
  ],
};
