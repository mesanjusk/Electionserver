// server/middleware/roles.js

/** Basic authentication guard */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * Role-based authorization.
 * Usage: app.get('/admin', auth, requireRole('admin'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/**
 * Optional middleware to restrict candidate accounts
 * to their bound device only.
 * Use after JWT auth + extractDeviceId middleware.
 */
export function requireSameDevice(req, res, next) {
  // Only applies to candidate-type users
  if (req.user?.role === 'candidate') {
    const currentDevice = req.deviceId;
    const boundDevice = req.user?.deviceIdBound;

    if (!boundDevice) {
      return res.status(423).json({
        error: 'DEVICE_NOT_BOUND',
        message:
          'Candidate account has not yet been activated on any device. Please log in once to bind it.',
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
