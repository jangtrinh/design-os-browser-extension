/**
 * Pure helpers for the popup pairing form. The pairing token is a secret:
 * the input is a password field, it is cleared after a successful save, and
 * a blank field means "keep the saved token" rather than "erase it".
 */

export interface SaveConfigPayload {
  cmd: 'save_config';
  brokerUrl: string;
  pairingToken?: string;
}

export function buildSaveConfigPayload(brokerUrlInput: string, tokenInput: string): SaveConfigPayload {
  const payload: SaveConfigPayload = { cmd: 'save_config', brokerUrl: brokerUrlInput.trim() };
  const token = tokenInput.trim();
  if (token) payload.pairingToken = token;
  return payload;
}

export const TOKEN_PLACEHOLDER_EMPTY = 'Paste token from browser-agent daemon token --reveal';
export const TOKEN_PLACEHOLDER_SAVED = 'Token saved (paste to replace)';

export function tokenPlaceholder(hasSavedToken: boolean): string {
  return hasSavedToken ? TOKEN_PLACEHOLDER_SAVED : TOKEN_PLACEHOLDER_EMPTY;
}
