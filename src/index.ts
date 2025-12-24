interface Env {
  HELIUS_API_KEY: string;
}

// Allow ANY subdomain of bidquit.fun + the apex bidquit.fun
function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname;

    // only allow https origins
    if (url.protocol !== "https:") return false;

    // explicit allow (even though it's covered by wildcard)
    if (origin === "https://testnet.bidquit.fun") return true;

    // allow bidquit.fun and *.bidquit.fun
    if (host === "bidquit.fun") return true;
    if (host.endsWith(".bidquit.fun")) return true;

    return false;
  } catch {
    return false;
  }
}

function makeCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") || "",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export default {
  async fetch(request: Request, env: Env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = makeCorsHeaders(request);

    // Preflight
    if (request.method === "OPTIONS") {
      // Return 204 for allowed origins, 403 otherwise (still with Vary etc.)
      if (origin && !isAllowedOrigin(origin)) {
        return new Response("Forbidden (CORS)", { status: 403, headers: corsHeaders });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Block actual browser requests from disallowed origins
    if (origin && !isAllowedOrigin(origin)) {
      return new Response("Forbidden (CORS)", { status: 403, headers: corsHeaders });
    }

    // WebSocket passthrough
    const upgrade = request.headers.get("Upgrade");
    if (upgrade && upgrade.toLowerCase() === "websocket") {
      return fetch(
        `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`,
        request
      );
    }

    const { pathname, search } = new URL(request.url);

    const method = request.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD" ? undefined : await request.text();

    const targetHost = pathname === "/" ? "mainnet.helius-rpc.com" : "api.helius.xyz";
    const targetUrl =
      `https://${targetHost}${pathname}?api-key=${env.HELIUS_API_KEY}` +
      (search ? `&${search.slice(1)}` : "");

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

    return new Response(res.body, {
      status: res.status,
      headers: corsHeaders,
    });
  },
};
