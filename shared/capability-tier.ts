export type CapabilityTier = 'tier1-chromium' | 'tier2-firefox' | 'tier3-safari';

export interface EngineCapabilities {
  tier: CapabilityTier;
  browserName: string;
  debuggerAttached: false;
  passiveMainObserver: boolean;
  sessionStorageFence: boolean;
  copilotApprovalQueue: true;
  adapterIds: string[];
}

/**
 * Adapters shipped in this extension build (one per directory under extension/src/adapters).
 * `linkedin-zero-drift` is the LinkedIn adapter's historical id; keep it first for compatibility.
 */
export const SHIPPED_ADAPTER_IDS = [
  'linkedin-zero-drift',
  'generic',
  'jobs',
  'producthunt',
  'reddit',
  'social-lists',
  'threads',
  'unikorn',
  'x',
  'youtube-studio',
] as const;

export function detectHostLittleEndian(): boolean {
  const probe = new Uint16Array([0x00ff]);
  const bytes = new Uint8Array(probe.buffer);
  return bytes[0] === 0xff;
}

export function buildCapabilities(params: {
  tier: CapabilityTier;
  browserName: string;
  passiveMainObserver: boolean;
  sessionStorageFence: boolean;
  adapterIds: string[];
}): EngineCapabilities {
  return {
    tier: params.tier,
    browserName: params.browserName,
    debuggerAttached: false,
    passiveMainObserver: params.passiveMainObserver,
    sessionStorageFence: params.sessionStorageFence,
    copilotApprovalQueue: true,
    adapterIds: [...params.adapterIds],
  };
}
