// One switch between the real engine service and the built-in mock.
//   ENGINE_API_URL unset  -> the mock in lib/mock (made-up data)
//   ENGINE_API_URL set    -> this route forwards the request to that service unchanged
// The browser only ever talks to /api/engine/..., so the page never holds the engine URL
// or any token. Nothing is logged here.

import { handleMock } from "@/lib/mock/handler";

export const dynamic = "force-dynamic";

async function proxy(req: Request, base: string, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const target = `${base.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}${url.search}`;
  const headers = new Headers();
  const type = req.headers.get("content-type");
  if (type) headers.set("content-type", type);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
    });
    const out = new Headers();
    for (const h of ["content-type", "content-disposition"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    return Response.json({ error: "The engine service could not be reached." }, { status: 502 });
  }
}

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const base = process.env.ENGINE_API_URL;
  if (base) return proxy(req, base, path);
  return handleMock(req, path);
}

export { handle as GET, handle as POST, handle as DELETE };
