import https from "node:https";
import tls from "node:tls";

/** Sequifi's marketplace host cert does not include marketplace-api.sequifi.com. */
export function isSequifiHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "sequifi.com" || host.endsWith(".sequifi.com");
}

const agent = new https.Agent({
  rejectUnauthorized: true,
  checkServerIdentity(hostname, cert) {
    if (isSequifiHost(hostname)) return undefined;
    return tls.checkServerIdentity(hostname, cert);
  },
});

export async function sequifiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input);
  if (url.protocol !== "https:" || !isSequifiHost(url.hostname)) {
    return fetch(input, init);
  }

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });

    const req = https.request(
      {
        agent,
        method: (init.method || "GET").toUpperCase(),
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value == null) continue;
            responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve(
            new Response(new Uint8Array(body), {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? "",
              headers: responseHeaders,
            }),
          );
        });
      },
    );

    req.on("error", reject);

    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy();
        reject(init.signal.reason ?? new Error("Aborted"));
        return;
      }
      init.signal.addEventListener("abort", () => req.destroy(), { once: true });
    }

    req.end();
  });
}
