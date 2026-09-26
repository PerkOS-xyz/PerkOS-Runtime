import type { IdentityAction, IdentityStatus } from "@perkos/ens";
import { PerkosClient } from "./client.ts";

export class DeskIdentities {
  constructor(private readonly client: PerkosClient) {}
  status(desk: string): Promise<IdentityStatus> {
    return this.client.request(`/project-templates/${encodeURIComponent(desk)}/identity`, { timeoutMs: 45_000 });
  }
  change(desk: string, action: IdentityAction): Promise<IdentityStatus> {
    return this.client.request(`/project-templates/${encodeURIComponent(desk)}/identity`, { method: "POST", body: action, timeoutMs: 60_000 });
  }
}
