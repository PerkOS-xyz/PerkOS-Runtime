import { NextResponse } from "next/server";
import { loadSettings } from "../../../../lib/settingsStore";
import { nudgeGuest } from "../../../../lib/guest";

export const dynamic = "force-dynamic";

/** Settings asks a guest to introduce itself. The bot only pulls, so this
 *  leaves the request on its seat and it arrives at the bot's next check. */
export async function POST(req: Request) {
  const s = await loadSettings();
  if (!s.wallet) return NextResponse.json({ error: "perkos_session_required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { seat?: number };
  const seat = s.guests.find((g) => g.seat === Number(body.seat));
  if (!seat) return NextResponse.json({ error: "unknown seat" }, { status: 404 });
  const ok = await nudgeGuest(seat.seat, seat.agentName, seat.agentId);
  return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
}
