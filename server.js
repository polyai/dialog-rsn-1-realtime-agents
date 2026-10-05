/**
 * Serves the page and relays two WebSockets, adding the API keys on the way out.
 *
 *   Browser  ->  ws://localhost:3000/realtime  ->  wss://api.us.poly.ai/v1/realtime  (POLY_API_KEY)
 *   Browser  ->  ws://localhost:3000/tts       ->  wss://api.cartesia.ai/tts/websocket (CARTESIA_API_KEY, optional)
 *
 * Everything else runs in the browser: the agents, their tools, the handoffs and the
 * supervisor. The relay exists only because a browser WebSocket can't set the
 * X-API-KEY header, and a key in page code is a key anyone can read.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const POLY_URL = process.env.POLY_URL || "wss://api.us.poly.ai/v1/realtime";
const POLY_API_KEY = process.env.POLY_API_KEY;
const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_URL = "wss://api.cartesia.ai/tts/websocket?cartesia_version=2025-04-16";

if (!POLY_API_KEY) {
  console.error("POLY_API_KEY is not set. Run `POLY_API_KEY=... npm start`, or put it in .env.");
  process.exit(1);
}

const PUBLIC = new URL("./public/", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/config") {
    // What the page can offer. Never the keys themselves.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ cartesia: Boolean(CARTESIA_API_KEY) }));
    return;
  }
  const path = normalize(decodeURIComponent(url.pathname));
  const file = join(PUBLIC, path === "/" ? "index.html" : path);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const upstreams = {
  "/realtime": { url: POLY_URL, headers: { "X-API-KEY": POLY_API_KEY } },
  ...(CARTESIA_API_KEY && { "/tts": { url: CARTESIA_URL, headers: { "X-API-Key": CARTESIA_API_KEY } } }),
};

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://x");
  const upstream = upstreams[pathname];
  // Only this page may use the keys: refuse sockets opened from any other origin.
  const sameOrigin = req.headers.origin === `http://${req.headers.host}`;
  if (!upstream || !sameOrigin) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => pipe(client, upstream, pathname));
});

function pipe(client, { url, headers }, name) {
  const remote = new WebSocket(url, {
    // The API answers 403 to a handshake with no User-Agent, and `ws` sends none.
    headers: { ...headers, "User-Agent": "dialog-rsn-1-realtime-agents/1.0" },
    // Fail fast on a stalled network rather than leaving the page waiting a minute.
    handshakeTimeout: 10_000,
  });
  // The page sends session.update as soon as its socket opens, before ours has.
  const backlog = [];
  const toRemote = (data) => (remote.readyState === WebSocket.OPEN ? remote.send(data) : backlog.push(data));

  remote.on("open", () => backlog.splice(0).forEach((data) => remote.send(data)));
  remote.on("message", (data) => client.readyState === WebSocket.OPEN && client.send(data.toString()));
  remote.on("close", (code, reason) => client.close(code === 1005 ? 1000 : code, reason));
  remote.on("error", (err) => {
    console.error(`[${name}] upstream error: ${err.message}`);
    client.close(1011, err.message.slice(0, 120));
  });
  client.on("message", (data) => toRemote(data.toString()));
  client.on("close", () => remote.close());
  client.on("error", () => remote.close());
}

server.listen(PORT, HOST, () => {
  console.log(`Dialog-RSN-1 realtime agents: http://localhost:${PORT}`);
  console.log(`  model  ${POLY_URL}`);
  console.log(`  voice  ${CARTESIA_API_KEY ? "Cartesia (CARTESIA_API_KEY set), or the browser's own" : "the browser's own (set CARTESIA_API_KEY for Cartesia)"}`);
});
