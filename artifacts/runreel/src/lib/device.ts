const KEY = "rr-device-id";

let _deviceId: string | null = null;

export function getDeviceId(): string {
  if (_deviceId) return _deviceId;
  const stored = localStorage.getItem(KEY);
  if (stored) {
    _deviceId = stored;
    return _deviceId;
  }
  return "";
}

export async function initDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  const stored = localStorage.getItem(KEY);
  if (stored) {
    _deviceId = stored;
    return _deviceId;
  }

  // Try to adopt existing "default" data (first device to open the app)
  try {
    const res = await fetch("/api/device/claim-default", { method: "POST" });
    const data = await res.json() as { claimed: boolean };
    if (data.claimed) {
      _deviceId = "default";
      localStorage.setItem(KEY, _deviceId);
      return _deviceId;
    }
  } catch { /* fallback to UUID */ }

  // Generate a new UUID for this device
  _deviceId = crypto.randomUUID();
  localStorage.setItem(KEY, _deviceId);
  return _deviceId;
}
