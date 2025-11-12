// server/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getDeviceIdFromHeaders } from '../lib/deviceId.js';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { username, password, userType?, deviceId? }
 * Header (optional): X-Device-Id
 */
router.post('/login', async (req, res) => {
  try {
    const {
      username,
      password,
      userType,
      deviceId: bodyDeviceId,
    } = req.body || {};

    const headerDeviceId = getDeviceIdFromHeaders(req);
    const deviceId = headerDeviceId || bodyDeviceId || null;

    // Basic checks
    const usernameCandidate =
      typeof username === 'string' && username.trim() ? username.trim() : '';
    if (!usernameCandidate || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    // Username-only lookup (case-insensitive via collation)
    const user = await User.findOne({ username: usernameCandidate })
      .collation({ locale: 'en', strength: 2 });

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
        user.deviceHistory.push({ deviceId, action: 'BOUND', by: 'system' });
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

    const payload = {
      id: user._id,
      role: user.role,
      username: user.username || null,
      allowedDatabaseIds: user.allowedDatabaseIds || [],
      deviceIdBound: user.deviceIdBound || null,
    };
    if (deviceId) payload.deviceId = deviceId;

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username || null,
        role: user.role,
        deviceIdBound: user.deviceIdBound || null,
        deviceBoundAt: user.deviceBoundAt || null,
        allowedDatabaseIds: user.allowedDatabaseIds || [],
      },
    });
  } catch (e) {
    console.error('LOGIN_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
