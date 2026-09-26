import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeskVerification, SeatIdentity } from "@perkos/ens";
import { Ensip25Proof, Ensip25Summary } from "../app/desks/Ensip25Proof";
import { ensStepLabel } from "../app/desks/EnsActivityLog";

const seat: SeatIdentity = { id: "scout", agentId: "real-id", registrationId: "42", wallet: "0x1111111111111111111111111111111111111111", resolver: "0x2222222222222222222222222222222222222222", writes: "scout-source" };
const checked = { id: "scout", name: "scout.desk.example.eth", verified: true, writeGranted: false, issues: [], ensip25: { key: "agent-registration[registry][42]", value: "attested", claimedName: "scout.desk.example.eth" } };
const verification: DeskVerification = { name: "desk.example.eth", verified: true, blockNumber: "123", issues: [], seats: [checked] };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

describe("visible ENSIP-25 proof", () => {
  it("shows the actual read value, declaration and block even without a publication grant", () => {
    const out = html(createElement(Ensip25Proof, { seat, checked, block: "123" }));
    for (const text of ["ENSIP-25 · Verified", "attested", "scout.desk.example.eth", "block 123", "Agent #42", "Sepolia (11155111)"]) expect(out).toContain(text);
  });
  it("never displays a positive badge from a manifest or failed verification", () => {
    expect(html(createElement(Ensip25Proof, { seat }))).toContain("ENSIP-25 · Not checked");
    const failed = html(createElement(Ensip25Proof, { seat, checked: { ...checked, verified: false, issues: ["attestation-missing"], ensip25: { ...checked.ensip25, value: "" } }, block: "123" }));
    expect(failed).toContain("ENSIP-25 · Not verified");
    expect(failed).not.toContain('data-verified="true"');
  });
  it("counts independently checked identities and labels the draft standard", () => {
    const out = html(createElement(Ensip25Summary, { verification, total: 7 }));
    expect(out).toContain("1/7 verified");
    expect(out).toContain("specification · Draft");
    expect(out).not.toContain('data-verified="true"');
    expect(html(createElement(Ensip25Summary, { verification: null, total: 7 }))).toContain("Verification pending");
  });
  it("distinguishes ENSIP-25 publication from agent context and ERC-8004 registration", () => {
    expect(ensStepLabel("text:scout:agent-registration[registry][42]")).toBe("Publish scout ENSIP-25 attestation");
    expect(ensStepLabel("text:scout:agent-context")).toBe("Publish scout ENSIP-26 context");
    expect(ensStepLabel("registration:scout")).toBe("Register scout with ERC-8004");
  });
});
