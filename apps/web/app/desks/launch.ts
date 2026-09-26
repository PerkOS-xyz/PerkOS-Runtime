/**
 * A token launch as the desk shows it, without a browser: where a launched
 * token can be seen. The server builds its receipts with the same links.
 */

export const LAUNCH_EXPLORER = "https://robinhoodchain.blockscout.com";

export interface LaunchLinks {
  uniswap: string;
  bankr: string;
  explorer: string;
}

/** Uniswap, Bankr and the Robinhood Chain explorer for a launched token. */
export const launchLinks = (token: string): LaunchLinks => ({
  uniswap: `https://app.uniswap.org/explore/tokens/robinhood/${token}`,
  bankr: `https://bankr.bot/launches/${token}`,
  explorer: `${LAUNCH_EXPLORER}/token/${token}`,
});

/** Said when a launch was sent and no clear answer came back: it may be on chain. */
export const LAUNCH_UNCONFIRMED = "Bankr did not confirm the launch, and it may still go out. Check the Bankr wallet on the explorer before trying again.";

export const launchTxUrl = (hash: string) => `${LAUNCH_EXPLORER}/tx/${hash}`;
export const launchAddressUrl = (address: string) => `${LAUNCH_EXPLORER}/address/${address}`;
