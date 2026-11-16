import type { EngineCapabilities } from './capability-tier.js';

export const DEFAULT_BROKER_HOST = '127.0.0.1' as const;
export const DEFAULT_BROKER_PORT = 4347 as const;
export const PROTOCOL_VERSION = '0.2.0' as const;
export const WS_KEEPALIVE_INTERVAL_MS = 20_000 as const;

export interface PageFence {
  tabId: number;
  pageId: string;
  epoch: number;
  leaseId: string;
}

export type HumanGateState =
  | 'CLEAR'
  | 'BLOCKED_CHALLENGE'
  | 'BLOCKED_AUTH'
  | 'BLOCKED_PAYMENT'
  | 'BLOCKED_POLICY';

export type DispatchOutcome =
  | 'COMMITTED'
  | 'UNCERTAIN'
  | 'REJECTED_STALE'
  | 'QUEUED_COPILOT'
  | 'BLOCKED';

export type CallerOrigin = 'agent-rpc' | 'extension-popup';

export interface RpcError {
  code: string;
  message: string;
  humanGate?: HumanGateState;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface RpcRequest<P = Record<string, unknown>> {
  id: string;
  action: string;
  params: P;
  fence?: PageFence;
  callerOrigin?: CallerOrigin;
  timeoutMs?: number;
}

export interface RpcResponse<T = unknown> {
  id: string;
  ok: boolean;
  outcome: DispatchOutcome;
  fence?: PageFence;
  humanGate?: HumanGateState;
  data?: T;
  error?: RpcError;
}

export interface BridgeHello {
  type: 'hello';
  token: string;
  extensionVersion: string;
  capabilities: EngineCapabilities;
}

export interface BridgeHelloOk {
  type: 'hello_ok';
  serverVersion: string;
  protocolVersion: string;
}

export interface BridgePing {
  type: 'ping';
  timestamp: number;
}

export interface BridgePong {
  type: 'pong';
  timestamp: number;
}

export interface BridgeRpcMessage {
  type: 'rpc';
  request: RpcRequest;
}

export interface BridgeRpcResultMessage {
  type: 'rpc_result';
  response: RpcResponse;
}

export interface BridgeEvent {
  type: 'event';
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type BridgeWireMessage =
  | BridgeHello
  | BridgeHelloOk
  | BridgePing
  | BridgePong
  | BridgeRpcMessage
  | BridgeRpcResultMessage
  | BridgeEvent;
