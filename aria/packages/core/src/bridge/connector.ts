import type { ToolDefinition } from '../brain/adapter.js';

export interface BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(input: Record<string, unknown>): Promise<string>;
}

export class AgentBridgeConnector {
  private adapters = new Map<string, BridgeAdapter>();

  register(name: string, adapter: BridgeAdapter) {
    this.adapters.set(name, adapter);
  }

  async dispatch(name: string, input: Record<string, unknown>): Promise<string> {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`No bridge adapter registered for: ${name}`);
    return adapter.call(input);
  }

  toToolDefinitions(): ToolDefinition[] {
    return Array.from(this.adapters.values()).map((a) => ({
      name: a.name,
      description: a.description,
      parameters: a.inputSchema,
    }));
  }

  has(name: string): boolean {
    return this.adapters.has(name);
  }
}
