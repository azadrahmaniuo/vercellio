export const config = { runtime: "edge" };

const TARGET_BASE = "https://mase.codol.ir:6969".replace(/\/$/, "");
const SECRET = process.env.SECRET_KEY;
const DAILY_LIMIT = 1024 * 1024 * 1024; // 1 گیگابایت

import { kv } from '@vercel/kv';

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

async function getUsage(ip) {
  const key = `usage:${ip}`;
  let data = await kv.get(key);

  if (!data) {
    const resetTime = Date.now() + 24 * 60 * 60 * 1000;
    data = { bytes: 0, resetTime };
    await kv.set(key, data, { ex: 86400 });
    return data;
  }

  if (Date.now() > data.resetTime) {
    const resetTime = Date.now() + 24 * 60 * 60 * 1000;
    data = { bytes: 0, resetTime };
    await kv.set(key, data, { ex: 86400 });
    return data;
  }

  return data;
}

export default async function handler(req) {
  if (!SECRET) {
    return new Response("Server Misconfigured", { status: 500 });
  }

  const url = new URL(req.url);
  const providedSecret = req.headers.get("x-secret") || url.searchParams.get("s");

  // Authentication
  if (providedSecret !== SECRET) {
    return new Response("Not Found", { status: 404 });
  }

  const ip = req.headers.get("x-real-ip") ||
             req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
             "unknown";

  try {
    const usage = await getUsage(ip);

    if (usage.bytes >= DAILY_LIMIT) {
      return new Response("Daily limit exceeded (1GB per day)", { 
        status: 429,
        headers: { "Retry-After": "86400" }
      });
    }

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

    const contentLength = parseInt(response.headers.get("content-length") || "0");
    const estimatedBytes = contentLength > 0 ? contentLength : 8192;

    await kv.set(`usage:${ip}`, {
      bytes: usage.bytes + estimatedBytes,
      resetTime: usage.resetTime
    }, { ex: 86400 });

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
