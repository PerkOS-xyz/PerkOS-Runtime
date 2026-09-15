import { issueNonce } from "../../../lib/nonceStore";

function addr(v: string | null) {
  if (!v) return "";
  return /^0x[a-fA-F0-9]{40}$/.test(v) ? v : "";
}

export async function GET(req: Request) {
  const address = addr(new URL(req.url).searchParams.get("address"));
  if (!address) return Response.json({ error: "address" }, { status: 400 });
  return Response.json(issueNonce(address));
}
