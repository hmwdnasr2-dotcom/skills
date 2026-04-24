import type { BridgeAdapter } from '../connector.js';

export class N8nAdapter implements BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(
    private config: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      webhookUrl: string;
      secret?: string;
    },
  ) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  async call(input: Record<string, unknown>): Promise<string> {
    const res = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.secret
          ? { Authorization: `Bearer ${this.config.secret}` }
          : {}),
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      throw new Error(`n8n webhook error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
}
