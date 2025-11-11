// server/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { username?, email?, password, userType?, deviceId? }
 * Header (optional): X-Device-Id
 */
router.post('/login', async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      userType,
      deviceId: bodyDeviceId,
    } = req.body || {};
    const headerDeviceId =
      req.get('X-Device-Id') ||
      req.get('x-device-id') ||
      req.get('X-DEVICE-ID');
    const deviceId = headerDeviceId || bodyDeviceId || null;

    // Basic checks
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const usernameCandidate =
      typeof username === 'string' && username.trim() !== '' ? username.trim() : '';
    const emailCandidate =
      typeof email === 'string' && email.trim() !== '' ? email.trim() : '';

    if (!usernameCandidate && !emailCandidate) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    // Look up by username or email
    const queries = [];
    if (usernameCandidate) {
      queries.push({ username: usernameCandidate }, { email: usernameCandidate });
    }
    if (emailCandidate) {
      queries.push({ email: emailCandidate }, { username: emailCandidate });
    }
    // de-duplicate
    const seen = new Set();
    const deduped = [];
    for (const q of queries) {
      const [[k, v]] = Object.entries(q);
      const key = `${k}:${v}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push({ [k]: v });
      }
    }

    const user = await User.findOne(deduped.length === 1 ? deduped[0] : { $or: deduped });
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
      email: user.email || null,
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
        email: user.email || null,
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
