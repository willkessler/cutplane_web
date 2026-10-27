import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { WebSocketServer } from 'ws';
import { Bridge } from './bridge.ts';
import { addTools } from './tools.ts';

export const DEFAULT_PORT = 5174;

export interface Options {
  port?: number;
  host?: string;
  /** Where save puts the .cut files. */
  saveDir: string;
}

export interface Running {
  port: number;
  bridge: Bridge;
  close(): Promise<void>;
}

/**
 * One port: the agent's MCP over HTTP at /mcp (stateless: each request its own server),
 * and the app's WebSocket at /bridge.
 */
export async function serve({
  port = DEFAULT_PORT,
  host = '0.0.0.0',
  saveDir,
}: Options): Promise<Running> {
  const bridge = new Bridge();
  const http: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/mcp') {
      const server = new McpServer({ name: 'cutplane', version: '0.0.0' });
      addTools(server, bridge, saveDir);
      // (No session ids: stateless.)
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      server
        .connect(transport)
        .then(() => transport.handleRequest(req, res))
        .catch((e: unknown) => {
          if (!res.headersSent) res.writeHead(500).end(String(e));
        });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(
      `Cutplane MCP: the agent at /mcp; ${bridge.connected ? 'a page is connected' : 'no page connected (open the app with ?mcp)'}.\n`,
    );
  });
  const sockets = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/bridge') return socket.destroy();
    sockets.handleUpgrade(req, socket, head, (ws) => bridge.attach(ws));
  });
  await new Promise<void>((ok) => http.listen(port, host, ok));
  return {
    port: (http.address() as AddressInfo).port,
    bridge,
    close: async () => {
      bridge.close();
      sockets.close();
      http.closeAllConnections();
      await new Promise((ok) => http.close(ok));
    },
  };
}
