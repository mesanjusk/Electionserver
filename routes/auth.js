// server/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getDeviceIdFromHeaders } from '../lib/deviceId.js';

/**
 * Optional helper to list all voter DBs with labels.
 * If you already have something like this elsewhere, import that instead.
 * Must return: [{ id: 'collection_name', name: 'Readable Label' }, ...]
 */
async function listVoterDatabases() {
  // Minimal fallback: if you don't have a DB registry, just map allowed ids to labels
  // Replace with your real registry if available.
  return []; // <- If you have a registry, return it here.
}

const router = Router();

/**
 * POST /api/auth/login
 * Body: { username, password, userType?, deviceId? }
 * Header (optional): X-Device-Id
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password, userType, deviceId: bodyDeviceId } =
      req.body || {};
    const headerDeviceId = getDeviceIdFromHeaders(req);
    const deviceId = headerDeviceId || bodyDeviceId || null;

    // Basic checks
    const usernameCandidate =
      typeof username === 'string' && username.trim()
        ? username.trim()
        : '';
    if (!usernameCandidate || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    // Username lookup (case-insensitive)
    const user = await User.findOne({ username: usernameCandidate }).collation({
      locale: 'en',
      strength: 2,
    });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    // Optional role gate (if client sends userType)
    if (userType) {
      const normalizedType = String(userType).toLowerCase();
      let expectedRoles;
      if (normalizedType === 'volunteer') {
        expectedRoles = new Set(['user', 'operator']);
      } else if (normalizedType) {
        expectedRoles = new Set([normalizedType]);
      }
      if (expectedRoles && !expectedRoles.has(user.role)) {
        return res.status(403).json({ error: 'Role mismatch' });
      }
    }

    // Device binding for candidates (first login binds)
    if (user.role === 'candidate') {
      if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 6) {
        return res.status(400).json({
          error: 'Missing or invalid device ID',
          message: 'Device ID required for candidate activation.',
        });
      }
      if (!user.deviceIdBound) {
        user.deviceIdBound = deviceId;
        user.deviceBoundAt = new Date();
        if (!Array.isArray(user.deviceHistory)) user.deviceHistory = [];
        user.deviceHistory.push({
          deviceId,
          action: 'BOUND',
          by: 'system',
        });
        await user.save();
      } else if (user.deviceIdBound !== deviceId) {
        return res.status(423).json({
          error: 'ACCOUNT_LOCKED_DIFFERENT_DEVICE',
          message:
            'This candidate account is already activated on another device. Ask an admin to reset your device binding.',
          boundAt: user.deviceBoundAt,
        });
      }
    }

    // Decide active database for this session
    const allowed = Array.isArray(user.allowedDatabaseIds)
      ? user.allowedDatabaseIds
      : [];
    let activeDatabaseId = null;

    if (allowed.length === 1) {
      activeDatabaseId = allowed[0];
    } else if (allowed.length > 1) {
      // pick the first allowed; optionally replace with a stored user preference
      activeDatabaseId = allowed[0];
    }

    // Provide databases list (filtered to allowed)
    let databases = [];
    try {
      const all = await listVoterDatabases(); // [{ id, name }, ...]
      if (Array.isArray(all) && all.length) {
        const allowedSet = new Set(allowed);
        databases = all.filter((d) => allowedSet.has(d.id));
      } else {
        // Fallback: synthesize labels from allowed ids
        databases = allowed.map((id) => ({ id, name: id }));
      }
    } catch {
      databases = allowed.map((id) => ({ id, name: id }));
    }

    // Token payload
    const payload = {
      id: user._id,
      role: user.role,
      username: user.username || null,
      allowedDatabaseIds: allowed,
      deviceIdBound: user.deviceIdBound || null,
      // optional: we *can* include avatarUrl here if you want it in token
      avatarUrl: user.avatarUrl || null,
    };
    if (deviceId) payload.deviceId = deviceId;

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    // Respond with user info (including avatarUrl) + DB info
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username || null,
        role: user.role,
        deviceIdBound: user.deviceIdBound || null,
        deviceBoundAt: user.deviceBoundAt || null,
        allowedDatabaseIds: allowed,
        avatarUrl: user.avatarUrl || null, // 👈 IMPORTANT for Home.jsx avatar
      },
      activeDatabaseId, // 👈 client uses this to choose DB
      databases, // 👈 for UI display
    });
  } catch (e) {
    console.error('LOGIN_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
