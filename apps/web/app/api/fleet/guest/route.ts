import { NextResponse } from "next/server";
import { loadSettings, saveSettings } from "../../../lib/settingsStore";
import { inviteFloorGuest, guestStatus, readGuestInvitePrompt, guestLook, MAX_GUESTS } from "../../../lib/guest";
import { PerkosApiError } from "../../../lib/perkosApi";

export const dynamic = "force-dynamic";

/** A paste the bot cannot connect with is worse than no paste: it looks fine. */
const complete = (prompt: string) =>
  prompt.includes("PERKOS_RELAY_KEY=") && prompt.includes("PERKOS_AGENT_ID=");

type Seat = {
  seat: number;
  agentId: string;
  agentName: string;
  status: string;
  prompt?: string;
  complete: boolean;
  /** What the bot calls itself, and how it wants to be drawn. */
  displayName?: string;
  accent?: string;
  style?: string;
  /** El asiento esta en pie ahora mismo, no lo que la plataforma recuerde. */
  live?: boolean;
};

export async function GET() {
  const s = await loadSettings();
  if (!s.wallet) return NextResponse.json({ error: "perkos_session_required" }, { status: 401 });
  const rows = s.guests.length ? s.guests : [];
  const seats: Seat[] = await Promise.all(
    rows.map(async (g) => {
      const prompt = await readGuestInvitePrompt(g.seat);
      let status = "unknown";
      let name = g.agentName;
      try {
        const st = await guestStatus(s.wallet, g.agentId);
        status = st.status;
        name = g.agentName || st.name || "";
      } catch {
        /* the row still shows, with what we know */
      }
      const look = await guestLook(g.seat, g.agentName, g.agentId);
      return { seat: g.seat, agentId: g.agentId, agentName: name, status, prompt: prompt || undefined, complete: complete(prompt), displayName: look.displayName || undefined, accent: look.accent || undefined, style: look.style || undefined, live: look.live };
    })
  );
  const first = seats[0];
  return NextResponse.json({
    // The single-guest shape stays for anything still reading it.
    invited: seats.length > 0,
    agentId: first?.agentId,
    agentName: first?.agentName,
    displayName: first?.displayName,
    status: first?.status,
    prompt: first?.prompt,
    complete: first?.complete ?? false,
    seats,
    canInviteMore: seats.length < MAX_GUESTS
  });
}

export async function POST() {
  const s = await loadSettings();
  if (!s.wallet) return NextResponse.json({ error: "perkos_session_required" }, { status: 401 });
  if (s.guests.length >= MAX_GUESTS) {
    return NextResponse.json({ error: `This desk already has ${MAX_GUESTS} guests`, code: "GUEST_LIMIT" }, { status: 409 });
  }
  // Seats are numbered, never reused while another one holds the number: two
  // bots on the same name would knock each other off the relay.
  const seat = (s.guests.reduce((max, g) => Math.max(max, g.seat), 0) || 0) + 1;
  try {
    const g = await inviteFloorGuest(s.wallet, seat);
    const guests = [...s.guests.filter((x) => x.seat !== seat), { agentId: g.agentId, agentName: g.agentName, seat }];
    await saveSettings({ ...s, guests, guestAgentId: guests[0].agentId, guestName: guests[0].agentName });
    const prompt = g.prompt || (await readGuestInvitePrompt(seat));
    return NextResponse.json({
      ok: true,
      seat,
      agentId: g.agentId,
      agentName: g.agentName,
      status: g.status,
      prompt: prompt || undefined,
      complete: g.complete ?? complete(prompt)
    });
  } catch (e) {
    const err = e as PerkosApiError;
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status || 500 });
  }
}
