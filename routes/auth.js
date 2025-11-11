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

    // ---- Basic checks ----
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const usernameCandidate =
      typeof username === 'string' && username.trim() !== ''
        ? username.trim()
        : '';
    const emailCandidate =
      typeof email === 'string' && email.trim() !== '' ? email.trim() : '';

    if (!usernameCandidate && !emailCandidate) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const queryCandidates = [];
    if (usernameCandidate) {
      queryCandidates.push({ username: usernameCandidate });
      queryCandidates.push({ email: usernameCandidate });
    }
    if (emailCandidate) {
      queryCandidates.push({ email: emailCandidate });
    }

    const deduped = [];
    const seen = new Set();
    for (const candidate of queryCandidates) {
      const [[key, value]] = Object.entries(candidate);
      const hash = `${key}:${value}`;
      if (!seen.has(hash)) {
        seen.add(hash);
        deduped.push({ [key]: value });
      }
    }

    const user = await User.findOne(
      deduped.length === 1 ? deduped[0] : { $or: deduped }
    );
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    // ---- Optional role match check ----
    if (userType && userType !== user.role) {
      return res.status(403).json({ error: 'Role mismatch' });
    }

    // ---- Device binding logic for candidates ----
    if (user.role === 'candidate') {
      if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 6) {
        return res.status(400).json({
          error: 'Missing or invalid device ID',
          message:
            'Device ID required for candidate activation. Please retry login from a registered device.',
        });
      }

      if (!user.deviceIdBound) {
        // First successful login → bind this device
        user.deviceIdBound = deviceId;
        user.deviceBoundAt = new Date();
        user.deviceHistory.push({
          deviceId,
          action: 'BOUND',
          by: 'system',
        });
        await user.save();
      } else if (user.deviceIdBound !== deviceId) {
        // Block login from other devices
        return res.status(423).json({
          error: 'ACCOUNT_LOCKED_DIFFERENT_DEVICE',
          message:
            'This candidate account is already activated on another device. Ask an admin to reset your device binding.',
          boundAt: user.deviceBoundAt,
        });
      }
    }

    // ---- Generate token ----
    const tokenPayload = {
      id: user._id,
      role: user.role,
      username: user.username || null,
      email: user.email || null,
      allowedDatabaseIds: user.allowedDatabaseIds || [],
      deviceIdBound: user.deviceIdBound || null,
    };
    if (deviceId) tokenPayload.deviceId = deviceId;

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    // ---- Response ----
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
