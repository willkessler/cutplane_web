import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** An MCP client on the server at `url` (for tests, and scripts that work the app). */
export async function connect(url: string): Promise<Client> {
  const client = new Client({ name: 'cutplane-script', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}
