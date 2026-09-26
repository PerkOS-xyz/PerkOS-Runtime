import type { IdentityAction, IdentityStatus } from "@perkos/ens";
import { PerkosClient } from "./client.ts";

export class DeskIdentities {
  constructor(private readonly client: PerkosClient) {}
  preview<T>(desk: string, input: { action: "move"; parentName: string; label: string } | { action: "evidence"; taskId: string; decisionId: string; response: string }): Promise<T> {
    return this.client.request(`/project-templates/${encodeURIComponent(desk)}/identity/preview`, { method: "POST", body: input, timeoutMs: 60_000 });
  }
  status(desk: string): Promise<IdentityStatus> {
    return this.client.request(`/project-templates/${encodeURIComponent(desk)}/identity`, { timeoutMs: 45_000 });
  }
  change(desk: string, action: IdentityAction): Promise<IdentityStatus> {
    return this.client.request(`/project-templates/${encodeURIComponent(desk)}/identity`, { method: "POST", body: action, timeoutMs: 60_000 });
  }
}
