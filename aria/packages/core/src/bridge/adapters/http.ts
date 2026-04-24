import type { BridgeAdapter } from '../connector.js';

export class HttpBridgeAdapter implements BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(
    private config: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      url: string;
      headers?: Record<string, string>;
      resultPath?: string;
    },
  ) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  async call(input: Record<string, unknown>): Promise<string> {
    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      body: JSON.stringify(input),
    });

    if (!res.ok) throw new Error(`HTTP bridge error: ${res.status}`);
    const data = await res.json();

    if (this.config.resultPath) {
      const value = this.config.resultPath
        .split('.')
        .reduce(
          (o: unknown, k) => (o as Record<string, unknown>)?.[k],
          data,
        );
      return typeof value === 'string' ? value : JSON.stringify(value);
    }

    return typeof data === 'string' ? data : JSON.stringify(data);
  }
}
