// lib/deviceId.js
// Utility helpers for working with device IDs coming from custom headers/body.

const HEADER_CANDIDATES = [
  'X-Device-Id',
  'x-device-id',
  'X_DEVICE_ID',
  'x_device_id',
  'X-DEVICE-ID',
  'Device-Id',
  'device-id',
  'deviceId',
  'deviceid',
];

const HEADER_ALLOWLIST = [
  'X-Device-Id',
  'x-device-id',
  'X_DEVICE_ID',
  'x_device_id',
  'Device-Id',
  'device-id',
  'deviceId',
  'deviceid',
];

/**
 * Try to pull the device ID from any of the supported header variants.
 * Express treats header lookups case-insensitively but we also account for
 * slightly different spellings that clients have historically used.
 */
export function getDeviceIdFromHeaders(req) {
  for (const candidate of HEADER_CANDIDATES) {
    const value = req.get(candidate);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/**
 * Resolve the effective device ID for the request, preferring headers and
 * falling back to the body-provided value when present.
 */
export function resolveRequestDeviceId(req, bodyDeviceId) {
  const headerDeviceId = getDeviceIdFromHeaders(req);
  if (headerDeviceId) return headerDeviceId;
  if (typeof bodyDeviceId === 'string') {
    const trimmed = bodyDeviceId.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Headers that should be advertised in CORS responses so that browsers allow
 * the custom device ID header variations used by different clients.
 */
export const CORS_ALLOWED_HEADERS = Array.from(
  new Set(['Content-Type', 'Authorization', ...HEADER_ALLOWLIST])
);

