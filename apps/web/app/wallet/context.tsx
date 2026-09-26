"use client";

import { createContext, useContext, type ReactNode } from "react";

export type Wallet = {
  /** A wallet connector is configured. */
  enabled: boolean;
  /** The connector has finished loading. */
  loaded: boolean;
  connected: boolean;
  /** Checksummed address, empty when not connected. */
  address: string;
  busy: boolean;
  error: string;
  open: () => void;
  logout: () => Promise<void>;
  /** personal_sign with the connected wallet. */
  signMessage: (message: string) => Promise<string>;
  /** Send one transaction from the connected wallet on that chain, and wait for it to land. */
  sendTransaction: (tx: WalletTransaction) => Promise<{ hash: `0x${string}`; status: "success" | "reverted" }>;
};

export type WalletTransaction = { chainId: number; to: `0x${string}`; data: `0x${string}`; value?: bigint };

export const disabledWallet: Wallet = {
  enabled: false,
  loaded: true,
  connected: false,
  address: "",
  busy: false,
  error: "",
  open: () => undefined,
  logout: async () => undefined,
  signMessage: async () => {
    throw new Error("No wallet connector configured");
  },
  sendTransaction: async () => {
    throw new Error("No wallet connector configured");
  }
};

const Ctx = createContext<Wallet>(disabledWallet);

export function WalletContext({ value, children }: { value: Wallet; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  return useContext(Ctx);
}
