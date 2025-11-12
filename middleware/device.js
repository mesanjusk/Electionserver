// middleware/device.js
import { resolveRequestDeviceId } from '../lib/deviceId.js';

export function extractDeviceId(req, _res, next) {
  // Prefer a dedicated header, fallback to body field for older clients
  req.deviceId = resolveRequestDeviceId(req, req.body?.deviceId);
  next();
}
