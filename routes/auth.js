// server/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { listVoterDatabases } from '../models/Voter.js';
import { getDeviceIdFromHeaders } from '../lib/deviceId.js';

const router = Router();

function buildUserPayload(user) {
  const allowed = Array.isArray(user.allowedDatabaseIds)
    ? user.allowedDatabaseIds
    : [];

  return {
    id: user._id,
    username: user.username || null,
    role: user.role,
    deviceIdBound: user.deviceIdBound || null,
    deviceBoundAt: user.deviceBoundAt || null,
    allowedDatabaseIds: allowed,
    avatarUrl: user.avatarUrl || null,
    parentUserId: user.parentUserId || null,
    parentUsername: user.parentUsername || '',
    enabled: user.enabled !== false,
  };
}

async function buildDatabasesForUser(user) {
  const allowed = Array.isArray(user.allowedDatabaseIds)
    ? user.allowedDatabaseIds
    : [];

  let databases = [];
  try {
    const all = await listVoterDatabases();
    if (Array.isArray(all) && all.length) {
      const allowedSet = new Set(allowed);
      databases = all.filter((d) => allowedSet.has(d.id));
    } else {
      databases = allowed.map((id) => ({ id, name: id }));
    }
  } catch (e) {
    console.error('LIST_VOTER_DATABASES_ERROR', e);
    databases = allowed.map((id) => ({ id, name: id }));
  }

  return { allowed, databases };
}

function chooseActiveDatabaseId(allowed) {
  if (!allowed || !allowed.length) return null;
  if (allowed.length === 1) return allowed[0];
  return allowed[0];
}

/**
 * POST /api/auth/login
 * Body: { username, password, userType?, deviceId?, pin? }
 * Header (optional): X-Device-Id
 *
 * This is the "full" login using username + password.
 * If "pin" is provided and user.pinHash is empty, we store the PIN hash.
 */
router.post('/login', async (req, res) => {
  try {
    const {
      username,
      password,
      userType, // currently unused, kept for backward compatibility
      deviceId: bodyDeviceId,
      pin,
    } = req.body || {};

    const headerDeviceId = getDeviceIdFromHeaders(req);
    const deviceId = headerDeviceId || bodyDeviceId || null;

    const usernameCandidate =
      typeof username === 'string' && username.trim()
        ? username.trim().toLowerCase()
        : '';

    if (!usernameCandidate || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const user = await User.findOne({ username: usernameCandidate }).collation(
      { locale: 'en', strength: 2 }
    );

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Block disabled users
    if (user.enabled === false) {
      return res.status(403).json({ error: 'User disabled by admin' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // ✅ Device binding for CANDIDATES (strict: lock to first device)
    if (user.role === 'candidate') {
      if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 6) {
        return res.status(400).json({
          error: 'Missing or invalid device ID',
          message: 'Device ID required for candidate activation.',
        });
      }

      if (user.deviceIdBound && user.deviceIdBound !== deviceId) {
        return res.status(423).json({
          error: 'ACCOUNT_LOCKED_DIFFERENT_DEVICE',
          message:
            'This candidate account is already activated on another device. Ask an admin to reset your device binding.',
          boundAt: user.deviceBoundAt,
        });
      }

      if (!user.deviceIdBound) {
        user.deviceIdBound = deviceId;
        user.deviceBoundAt = new Date();
        if (!Array.isArray(user.deviceHistory)) {
          user.deviceHistory = [];
        }
        user.deviceHistory.push({
          deviceId,
          action: 'BOUND_LOGIN',
          by: 'system',
        });
      }
    }

    // ✅ Device tracking for VOLUNTEERS (lenient: track, but do NOT block login)
    if (user.role === 'volunteer') {
      if (deviceId && typeof deviceId === 'string' && deviceId.length >= 6) {
        if (!Array.isArray(user.deviceHistory)) {
          user.deviceHistory = [];
        }

        // if previously bound to a different device, log the switch but allow it
        if (user.deviceIdBound && user.deviceIdBound !== deviceId) {
          user.deviceHistory.push({
            deviceId: user.deviceIdBound,
            action: 'VOLUNTEER_DEVICE_SWITCH',
            by: 'system',
          });
        }

        user.deviceIdBound = deviceId;
        user.deviceBoundAt = new Date();
        user.deviceHistory.push({
          deviceId,
          action: 'VOLUNTEER_LOGIN',
          by: 'system',
        });
      }
    }

    // If a PIN is provided on first login, store its hash (once)
    if (pin && typeof pin === 'string' && pin.length >= 2 && !user.pinHash) {
      try {
        user.pinHash = await bcrypt.hash(pin, 10);
      } catch (e) {
        console.error('PIN_HASH_ERROR', e);
      }
    }

    const { allowed, databases } = await buildDatabasesForUser(user);
    const activeDatabaseId = chooseActiveDatabaseId(allowed);

    const payload = {
      id: user._id,
      role: user.role,
      username: user.username || null,
      allowedDatabaseIds: allowed,
      deviceIdBound: user.deviceIdBound || null,
    };
    if (deviceId) payload.deviceId = deviceId;

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '30d', // can adjust if you like
    });

    await user.save();

    return res.json({
      token,
      user: buildUserPayload(user),
      activeDatabaseId,
      databases,
    });
  } catch (e) {
    console.error('LOGIN_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/auth/pin-login
 * Body: { username, pin, deviceId? }
 * Header (optional): X-Device-Id
 *
 * This is used by the app when token is missing/expired but
 * device has been activated and user wants to login with PIN only.
 */
router.post('/pin-login', async (req, res) => {
  try {
    const { username, pin, deviceId: bodyDeviceId } = req.body || {};
    const headerDeviceId = getDeviceIdFromHeaders(req);
    const deviceId = headerDeviceId || bodyDeviceId || null;

    const usernameCandidate =
      typeof username === 'string' && username.trim()
        ? username.trim().toLowerCase()
        : '';

    if (!usernameCandidate || !pin) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const user = await User.findOne({ username: usernameCandidate }).collation(
      { locale: 'en', strength: 2 }
    );
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Block disabled users
    if (user.enabled === false) {
      return res.status(403).json({ error: 'User disabled by admin' });
    }

    if (!user.pinHash) {
      return res.status(400).json({
        error: 'PIN_NOT_SET',
        message:
          'PIN is not set for this user. Please login once with username & password.',
      });
    }

    const ok = await bcrypt.compare(pin, user.pinHash);
    if (!ok) {
      return res.status(400).json({ error: 'Invalid PIN' });
    }

    // ✅ Enforce device binding for candidates (same as before)
    if (user.role === 'candidate') {
      if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 6) {
        return res.status(400).json({
          error: 'Missing or invalid device ID',
          message: 'Device ID required for candidate PIN login.',
        });
      }

      if (user.deviceIdBound && user.deviceIdBound !== deviceId) {
        return res.status(423).json({
          error: 'ACCOUNT_LOCKED_DIFFERENT_DEVICE',
          message:
            'This candidate account is already activated on another device. Ask an admin to reset your device binding.',
          boundAt: user.deviceBoundAt,
        });
      }

      if (!user.deviceIdBound) {
        user.deviceIdBound = deviceId;
        user.deviceBoundAt = new Date();
        if (!Array.isArray(user.deviceHistory)) {
          user.deviceHistory = [];
        }
        user.deviceHistory.push({
          deviceId,
          action: 'BOUND_PIN_LOGIN',
          by: 'system',
        });
      }
    }

    // ✅ Device tracking for VOLUNTEERS on PIN login (lenient, like normal login)
    if (user.role === 'volunteer') {
      if (deviceId && typeof deviceId === 'string' && deviceId.length >= 6) {
        if (!Array.isArray(user.deviceHistory)) {
          user.deviceHistory = [];
        }

        if (user.deviceIdBound && user.deviceIdBound !== deviceId) {
          user.deviceHistory.push({
            deviceId: user.deviceIdBound,
            action: 'VOLUNTEER_DEVICE_SWITCH_PIN',
            by: 'system',
          });
        }

        user.deviceIdBound = deviceId;
        user.deviceBoundAt = new Date();
        user.deviceHistory.push({
          deviceId,
          action: 'VOLUNTEER_PIN_LOGIN',
          by: 'system',
        });
      }
    }

    const { allowed, databases } = await buildDatabasesForUser(user);
    const activeDatabaseId = chooseActiveDatabaseId(allowed);

    const payload = {
      id: user._id,
      role: user.role,
      username: user.username || null,
      allowedDatabaseIds: allowed,
      deviceIdBound: user.deviceIdBound || null,
    };
    if (deviceId) payload.deviceId = deviceId;

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    await user.save();

    return res.json({
      token,
      user: buildUserPayload(user),
      activeDatabaseId,
      databases,
    });
  } catch (e) {
    console.error('PIN_LOGIN_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
