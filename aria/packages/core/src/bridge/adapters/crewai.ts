import type { BridgeAdapter } from '../connector.js';

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export class CrewAIAdapter implements BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(
    private config: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      serverUrl: string;
      crewName: string;
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  async call(input: Record<string, unknown>): Promise<string> {
    const kickRes = await fetch(`${this.config.serverUrl}/kickoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crew: this.config.crewName, inputs: input }),
    });
    if (!kickRes.ok) {
      throw new Error(`CrewAI kickoff failed: ${kickRes.status}`);
    }
    const { taskId } = await kickRes.json() as { taskId: string };

    const interval = this.config.pollIntervalMs ?? 2000;
    const timeout = this.config.timeoutMs ?? 120_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      await sleep(interval);
      const statusRes = await fetch(`${this.config.serverUrl}/status/${taskId}`);
      const status = await statusRes.json() as { state: string; result?: string };
      if (status.state === 'completed') return status.result ?? '';
      if (status.state === 'failed') {
        throw new Error(`CrewAI task ${taskId} failed`);
      }
    }

    throw new Error(`CrewAI task ${taskId} timed out`);
  }
}
