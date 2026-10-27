import { DEFAULT_PORT, serve } from './server.ts';

const port = Number(process.env['MCP_PORT'] ?? DEFAULT_PORT);
const saveDir = process.env['MCP_SAVE_DIR'] ?? 'corpus/mcp';
const { port: at } = await serve({ port, saveDir });
console.log(
  `Cutplane MCP on http://localhost:${at}/mcp; the app connects at /bridge (open it with ?mcp)`,
);
