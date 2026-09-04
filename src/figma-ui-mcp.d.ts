declare module 'figma-ui-mcp/server/bridge-server.js' {
  export const CONFIG: {
    readonly PORT: number
    readonly OP_TIMEOUT_MS: number
  }
  export class BridgeServer {
    readonly port: number
    start(): Promise<BridgeServer>
    stop(): void
    isPluginConnected(sessionId?: string): boolean
    sendOperation(operation: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>
  }
}
