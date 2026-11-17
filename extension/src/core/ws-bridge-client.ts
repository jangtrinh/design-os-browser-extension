import type {
  BridgeEvent,
  BridgeGuardSyncMessage,
  BridgeHello,
  BridgeRpcResultMessage,
  BridgeWireMessage,
  RpcRequest,
  RpcResponse,
} from '../../../shared/rpc-envelope.js';
import {
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  WS_KEEPALIVE_INTERVAL_MS,
} from '../../../shared/rpc-envelope.js';
import type { EngineCapabilities } from '../../../shared/capability-tier.js';
import type { KeyValueStore } from './webext-polyfill.js';

export const BRIDGE_CONFIG_KEY = 'design_os_bridge_config';

export interface StoredBridgeConfig {
  brokerUrl: string;
  pairingToken: string;
}

export const DEFAULT_BRIDGE_CONFIG: StoredBridgeConfig = {
  brokerUrl: `ws://${DEFAULT_BROKER_HOST}:${DEFAULT_BROKER_PORT}/ws`,
  pairingToken: '',
};

export interface WsConnectionStatus {
  connected: boolean;
  brokerUrl: string;
  hasToken: boolean;
  lastConnectedAt?: string;
  lastError?: string;
}

export class WsBridgeClient {
  private readonly store: KeyValueStore;
  private readonly capabilities: EngineCapabilities;
  private readonly extensionVersion: string;
  private readonly onRpcRequest: (req: RpcRequest) => Promise<RpcResponse>;
  private readonly onStatusChange?: (status: WsConnectionStatus) => void;
  private readonly onGuardSync?: (guards: BridgeGuardSyncMessage['guards']) => void;

  private ws: WebSocket | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1000;
  private stopped = false;
  private connected = false;
  private lastConnectedAt: string | undefined;
  private lastError: string | undefined;
  private currentConfig: StoredBridgeConfig = { ...DEFAULT_BRIDGE_CONFIG };

  constructor(options: {
    store: KeyValueStore;
    capabilities: EngineCapabilities;
    extensionVersion: string;
    onRpcRequest: (req: RpcRequest) => Promise<RpcResponse>;
    onStatusChange?: (status: WsConnectionStatus) => void;
    onGuardSync?: (guards: BridgeGuardSyncMessage['guards']) => void;
  }) {
    this.store = options.store;
    this.capabilities = options.capabilities;
    this.extensionVersion = options.extensionVersion;
    this.onRpcRequest = options.onRpcRequest;
    this.onStatusChange = options.onStatusChange;
    this.onGuardSync = options.onGuardSync;
  }

  async loadConfig(): Promise<StoredBridgeConfig> {
    const raw = await this.store.get([BRIDGE_CONFIG_KEY]);
    const saved = raw[BRIDGE_CONFIG_KEY] as Partial<StoredBridgeConfig> | undefined;
    this.currentConfig = {
      brokerUrl: saved?.brokerUrl || DEFAULT_BRIDGE_CONFIG.brokerUrl,
      pairingToken: saved?.pairingToken || '',
    };
    return this.currentConfig;
  }

  async saveConfig(next: Partial<StoredBridgeConfig>): Promise<StoredBridgeConfig> {
    const loaded = await this.loadConfig();
    this.currentConfig = {
      brokerUrl: next.brokerUrl?.trim() || loaded.brokerUrl,
      pairingToken: next.pairingToken !== undefined ? next.pairingToken.trim() : loaded.pairingToken,
    };
    await this.store.set({ [BRIDGE_CONFIG_KEY]: this.currentConfig });
    await this.reconnectNow();
    return this.currentConfig;
  }

  getStatus(): WsConnectionStatus {
    return {
      connected: this.connected,
      brokerUrl: this.currentConfig.brokerUrl,
      hasToken: this.currentConfig.pairingToken.length > 0,
      ...(this.lastConnectedAt ? { lastConnectedAt: this.lastConnectedAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.loadConfig();
    this.connect();
  }

  async reconnectNow(): Promise<void> {
    this.backoffMs = 1000;
    this.closeSocket();
    await this.loadConfig();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.closeSocket();
  }

  sendEvent(event: string, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: BridgeEvent = {
      type: 'event',
      event,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.ws.send(JSON.stringify(msg));
  }

  private notify(): void {
    this.onStatusChange?.(this.getStatus());
  }

  private closeSocket(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'reconnecting');
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.connected = false;
    this.notify();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  connect(): void {
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (!this.currentConfig.pairingToken) {
      this.connected = false;
      this.lastError = 'Pairing token not configured yet.';
      this.notify();
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.currentConfig.brokerUrl);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.notify();
      this.scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.addEventListener('open', () => {
      const hello: BridgeHello = {
        type: 'hello',
        token: this.currentConfig.pairingToken,
        extensionVersion: this.extensionVersion,
        capabilities: this.capabilities,
      };
      socket.send(JSON.stringify(hello));

      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      // 20-second keepalive prevents Chrome MV3 service worker termination while connected.
      this.keepaliveTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, WS_KEEPALIVE_INTERVAL_MS);
    });

    socket.addEventListener('message', (event) => {
      void this.handleRawMessage(socket, String(event.data));
    });

    socket.addEventListener('close', (ev) => {
      if (this.ws === socket) {
        this.ws = null;
      }
      if (this.keepaliveTimer) {
        clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = null;
      }
      this.connected = false;
      this.lastError = ev.reason || `Socket closed (${ev.code})`;
      this.notify();
      if (!this.stopped && ev.code !== 4001) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener('error', () => {
      this.lastError = `Cannot reach ${this.currentConfig.brokerUrl}`;
      this.notify();
    });
  }

  private async handleRawMessage(socket: WebSocket, raw: string): Promise<void> {
    let parsed: BridgeWireMessage;
    try {
      parsed = JSON.parse(raw) as BridgeWireMessage;
    } catch {
      return;
    }

    if (parsed.type === 'hello_ok') {
      this.connected = true;
      this.backoffMs = 1000;
      this.lastConnectedAt = new Date().toISOString();
      this.lastError = undefined;
      this.notify();
      return;
    }

    if (parsed.type === 'pong') {
      return;
    }

    if (parsed.type === 'guard_sync') {
      this.onGuardSync?.(parsed.guards);
      return;
    }

    if (parsed.type === 'rpc') {
      let response: RpcResponse;
      try {
        response = await this.onRpcRequest(parsed.request);
      } catch (err) {
        // Always answer: an uncaught handler error used to leave the daemon waiting until
        // RPC_BROKER_TIMEOUT (20 s) with no reason attached.
        response = {
          id: parsed.request.id,
          ok: false,
          outcome: 'BLOCKED',
          error: {
            code: 'EXTENSION_HANDLER_ERROR',
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
          },
        };
      }
      const reply: BridgeRpcResultMessage = {
        type: 'rpc_result',
        response,
      };
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(reply));
      }
    }
  }
}
