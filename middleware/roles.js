// server/middleware/roles.js

/** Basic authentication guard */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** Role-based authorization
 * Usage example:
 *   router.get('/admin-only', auth, requireRole('admin'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/** Optional: restrict candidate accounts to the bound device only.
 * Put after JWT auth and any middleware that sets req.deviceId (if you use one).
 */
export function requireSameDevice(req, res, next) {
  if (req.user?.role === 'candidate') {
    const currentDevice = req.deviceId;
    const boundDevice = req.user?.deviceIdBound;

    if (!boundDevice) {
      return res.status(423).json({
        error: 'DEVICE_NOT_BOUND',
        message: 'Candidate account not yet activated on any device.',
      });
    }
    if (!currentDevice || currentDevice !== boundDevice) {
      return res.status(423).json({
        error: 'ACCOUNT_LOCKED_DIFFERENT_DEVICE',
        message:
          'This Candidate account is already activated on another device. Ask an admin to reset the binding.',
      });
    }
  }
  next();
}
