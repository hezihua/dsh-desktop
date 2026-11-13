#!/usr/bin/env node
/**
 * stdio ↔ TCP bridge for DeepSeekHarness SDK (connects to infini-harness :9100).
 * Sends INFINI-HARNESS-PRODUCT so shared harness loads the right cordis profile.
 * Usage: node deploy/stdio-tcp-bridge.mjs <host:port>
 */
import net from "node:net";

const target = process.argv[2] || process.env.HARNESS_URL;
if (!target) {
  console.error("[stdio-tcp-bridge] HARNESS_URL or host:port argument required");
  process.exit(1);
}

const product =
  process.env.HARNESS_PRODUCT?.trim().toLowerCase() || "server-agent";

const [host, portStr] = target.includes("://")
  ? new URL(target).host.split(":")
  : target.split(":");
const port = Number(portStr || 9100);

const socket = net.connect({ host, port }, () => {
  socket.write(`INFINI-HARNESS-PRODUCT: ${product}\n`);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});

socket.on("error", (err) => {
  console.error("[stdio-tcp-bridge] connection error:", err.message);
  process.exit(1);
});

const shutdown = () => {
  socket.destroy();
  process.exit(0);
};

process.stdin.on("end", shutdown);
socket.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
