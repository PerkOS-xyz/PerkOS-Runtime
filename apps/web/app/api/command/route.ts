let last = { id: 0, text: "" };
const waiters: Array<(v: typeof last) => void> = [];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") || 0);
  if (last.id !== since && last.id) return Response.json(last);
  if (url.searchParams.get("wait") !== "1") return Response.json(last);
  const row = await new Promise<typeof last>((ok) => {
    const t = setTimeout(() => ok(last), 20000);
    waiters.push((v) => {
      clearTimeout(t);
      ok(v);
    });
  });
  return Response.json(row);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) return Response.json(last, { status: 400 });
  last = { id: last.id + 1, text };
  const q = waiters.splice(0);
  for (const fn of q) fn(last);
  return Response.json(last);
}
