export const config = { runtime: "edge" };

const TARGET_BASE = "https://mase.codol.ir:6969".replace(/\/$/, "");
const SECRET = process.env.SECRET_KEY;

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(req) {
  if (!SECRET) {
    return new Response("Server Misconfigured", { status: 500 });
  }

  const url = new URL(req.url);
  const providedSecret = req.headers.get("x-secret") || url.searchParams.get("s");

  if (providedSecret !== SECRET) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const pathStart = req.url.indexOf("/", 8);
    const targetUrl = pathStart === -1 
      ? TARGET_BASE + "/" 
      : TARGET_BASE + req.url.slice(pathStart);

    const out = new Headers();

    for (const [k, v] of req.headers) {
      if (STRIP_HEADERS.has(k) || k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip" || k === "x-forwarded-for") continue;
      out.set(k, v);
    }

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const response = await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half",
      redirect: "manual",
    });

    const resHeaders = new Headers(response.headers);
    resHeaders.delete("server");
    resHeaders.delete("x-powered-by");

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    });

  } catch (err) {
    console.error("Relay error:", err);
    return new Response("Bad Gateway", { status: 502 });
  }
}
