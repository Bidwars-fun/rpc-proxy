interface Env {
  CORS_ALLOW_ORIGIN: string; // comma-separated list, e.g. "https://testnet.bidquit.fun,https://bidquit.fun"
  HELIUS_API_KEY: string;
}

function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,OPTIONS",
    // IMPORTANT: echo requested headers instead of "*"
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") || "",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  const origin = request.headers.get("Origin");
  const allowList = (env.CORS_ALLOW_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // If you want to hard-block unknown origins, keep this strict behavior.
  // If you want to allow non-browser / no-Origin calls, you can handle `!origin` separately.
  if (!origin || allowList.length === 0) return corsHeaders;

  // Exact match
  if (allowList.includes(origin)) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;

    // Only set this if you actually use cookies/Authorization and need credentials.
    // If you DON'T need credentials, leave it off.
    // corsHeaders["Access-Control-Allow-Credentials"] = "true";
  }

  return corsHeaders;
}

export default {
  async fetch(request: Request, env: Env) {
    const corsHeaders = buildCorsHeaders(request, env);

    // If this is a browser CORS request and the origin isn't allowed, block early.
    // (If there's no Origin header, it's not a browser CORS request.)
    const origin = request.headers.get("Origin");
    if (origin && !("Access-Control-Allow-Origin" in corsHeaders)) {
      return new Response("Forbidden (CORS)", {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // WebSocket upgrade passthrough
    const upgrade = request.headers.get("Upgrade");
    if (upgrade && upgrade.toLowerCase() === "websocket") {
      // Keep headers exactly; don't replace them
      return fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, request);
    }

    const { pathname, search } = new URL(request.url);

    // Preserve body + method (GET/HEAD should not send a body)
    const method = request.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD" ? undefined : await request.text();

    const targetHost = pathname === "/" ? "mainnet.helius-rpc.com" : "api.helius.xyz";
    const targetUrl =
      `https://${targetHost}${pathname}?api-key=${env.HELIUS_API_KEY}` +
      (search ? `&${search.slice(1)}` : "");

    // Forward content-type if present, but don’t forward Origin
    const contentType = request.headers.get("Content-Type") || "application/json";

    const proxyRequest = new Request(targetUrl, {
      method,
      body: body && body.length ? body : undefined,
      headers: {
        "Content-Type": contentType,
        "X-Helius-Cloudflare-Proxy": "true",
      },
    });

    const res = await fetch(proxyRequest);

    // Return response with cors headers (and keep status)
    return new Response(res.body, {
      status: res.status,
      headers: corsHeaders,
    });
  },
};
