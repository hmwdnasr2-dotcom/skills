import type { BridgeAdapter } from '../connector.js';

export class LangChainAdapter implements BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(
    private config: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      serverUrl: string;
      apiKey?: string;
    },
  ) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  async call(input: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.config.serverUrl}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({ input }),
    });

    if (!res.ok) throw new Error(`LangChain agent error: ${res.status}`);

    const data = await res.json() as { output: unknown };
    return typeof data.output === 'string'
      ? data.output
      : JSON.stringify(data.output);
  }
}
