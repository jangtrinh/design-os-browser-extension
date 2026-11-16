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
