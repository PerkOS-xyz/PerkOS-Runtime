import { NextResponse } from "next/server";
import { loadSettings, saveSettings } from "../../../lib/settingsStore";
import { inviteFloorGuest, guestStatus, readGuestInvitePrompt } from "../../../lib/guest";
import { PerkosApiError } from "../../../lib/perkosApi";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await loadSettings();
  if (!s.wallet) return NextResponse.json({ error: "perkos_session_required" }, { status: 401 });
  const prompt = await readGuestInvitePrompt();
  if (!s.guestAgentId) return NextResponse.json({ invited: false, prompt: prompt || undefined });
  try {
    const st = await guestStatus(s.wallet, s.guestAgentId);
    return NextResponse.json({ invited: true, agentId: s.guestAgentId, agentName: s.guestName || st.name, status: st.status, prompt: prompt || undefined });
  } catch {
    return NextResponse.json({ invited: true, agentId: s.guestAgentId, agentName: s.guestName, status: "unknown", prompt: prompt || undefined });
  }
}

export async function POST() {
  const s = await loadSettings();
  if (!s.wallet) return NextResponse.json({ error: "perkos_session_required" }, { status: 401 });
  try {
    const g = await inviteFloorGuest(s.wallet);
    await saveSettings({ ...s, guestAgentId: g.agentId, guestName: g.agentName });
    return NextResponse.json({ ok: true, agentId: g.agentId, agentName: g.agentName, status: g.status, prompt: g.prompt || (await readGuestInvitePrompt()) || undefined });
  } catch (e) {
    const err = e as PerkosApiError;
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status || 500 });
  }
}
