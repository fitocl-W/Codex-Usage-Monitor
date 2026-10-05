export const LOCAL_TOKEN_ACTIVE_SCAN_MS = 750;
export const LOCAL_TOKEN_IDLE_SCAN_MS = 4000;
export const LOCAL_TOKEN_ACTIVE_WINDOW_MS = 15000;

export function localTokenNextScanDelay({
  now,
  lastActivityAt,
  activeScanMs = LOCAL_TOKEN_ACTIVE_SCAN_MS,
  idleScanMs = LOCAL_TOKEN_IDLE_SCAN_MS,
  activeWindowMs = LOCAL_TOKEN_ACTIVE_WINDOW_MS,
  generating = false,
}) {
  const active = generating || (Number.isFinite(lastActivityAt) && now - lastActivityAt <= activeWindowMs);
  return active ? Math.max(500, activeScanMs) : Math.max(1000, idleScanMs);
}
