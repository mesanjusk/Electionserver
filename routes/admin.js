// server/routes/admin.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { listVoterDatabases } from '../lib/voterDatabases.js';

const router = Router();

router.get('/databases', auth, requireRole('admin'), async (_req, res) => {
  try {
    const databases = await listVoterDatabases();
    res.json({ databases });
  } catch (e) {
    console.error('ADMIN_DATABASES_ERROR', e);
    res.status(500).json({ error: 'Unable to load voter databases.' });
  }
});

router.post('/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const {
      username,
      password,
      role = 'operator',
      databaseIds = [],
      email,
    } = req.body || {};

    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (!normalizedUsername) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res
        .status(400)
        .json({ error: 'Password must be at least 6 characters long.' });
    }

    const allowedRoles = ['admin', 'operator', 'candidate', 'user'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const normalizedEmail =
      typeof email === 'string' && email.trim() !== '' ? email.trim() : null;

    const existingUser = await User.findOne(
      normalizedEmail
        ? {
            $or: [
              { username: normalizedUsername },
              { email: normalizedEmail },
            ],
          }
        : { username: normalizedUsername }
    );

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    let allowedDatabaseIds = [];
    if (Array.isArray(databaseIds) && databaseIds.length > 0) {
      const available = await listVoterDatabases();
      const validIds = new Set(available.map(db => db.id));
      allowedDatabaseIds = Array.from(
        new Set(
          databaseIds
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(id => id && validIds.has(id))
        )
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail || undefined,
      passwordHash,
      role,
      allowedDatabaseIds,
    });

    res.json({
      ok: true,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        allowedDatabaseIds: user.allowedDatabaseIds,
      },
    });
  } catch (e) {
    console.error('ADMIN_CREATE_USER_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
