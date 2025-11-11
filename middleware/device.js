// middleware/device.js
export function extractDeviceId(req, _res, next) {
  // Prefer a dedicated header, fallback to body field for older clients
  const headerId =
    req.get("X-Device-Id") ||
    req.get("x-device-id") ||
    req.get("X-DEVICE-ID");
  req.deviceId = headerId || req.body?.deviceId || null;
  next();
}
