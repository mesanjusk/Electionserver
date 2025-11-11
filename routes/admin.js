// server/routes/admin.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { listVoterDatabases } from '../lib/voterDatabases.js';

const router = Router();

/** Get list of voter DBs to assign */
router.get('/databases', auth, requireRole('admin'), async (_req, res) => {
  try {
    const databases = await listVoterDatabases(); // [{ id, name }]
    res.json({ databases });
  } catch (e) {
    console.error('ADMIN_DATABASES_ERROR', e);
    res.status(500).json({ error: 'Unable to load voter databases.' });
  }
});

/** List users (lightweight) */
router.get('/users', auth, requireRole('admin'), async (_req, res) => {
  try {
    const users = await User.find({}, 'username role allowedDatabaseIds createdAt updatedAt')
      .sort({ createdAt: -1 });
    res.json({ users });
  } catch (e) {
    console.error('ADMIN_LIST_USERS_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Create user (username required; email optional; role; allowed DBs) */
router.post('/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const {
      username,
      password,
      role = 'user',
      allowedDatabaseIds = [],
      email,
    } = req.body || {};

    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (!normalizedUsername) return res.status(400).json({ error: 'Username is required.' });

    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
    }

    const allowedRoles = ['admin', 'operator', 'candidate', 'user'];
    if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const normalizedEmail =
      typeof email === 'string' && email.trim() !== '' ? email.trim() : null;

    // Prevent duplicates by username or email (if supplied)
    const existingUser = await User.findOne(
      normalizedEmail
        ? { $or: [{ username: normalizedUsername }, { email: normalizedEmail }] }
        : { username: normalizedUsername }
    );
    if (existingUser) return res.status(409).json({ error: 'User already exists' });

    // Validate DB IDs against available list
    let finalAllowed = [];
    if (Array.isArray(allowedDatabaseIds) && allowedDatabaseIds.length > 0) {
      try {
        const available = await listVoterDatabases();
        const validIds = new Set(available.map(db => db.id));
        finalAllowed = Array.from(
          new Set(
            allowedDatabaseIds
              .map(id => (typeof id === 'string' ? id.trim() : ''))
              .filter(id => id && validIds.has(id))
          )
        );
      } catch {
        // If listing fails, still allow saving requested IDs (optional behavior)
        finalAllowed = [...new Set(allowedDatabaseIds.filter(Boolean))];
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail || undefined,
      passwordHash,
      role,
      allowedDatabaseIds: finalAllowed,
    });

    res.status(201).json({
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

/** Delete user */
router.delete('/users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    // Prevent self-delete
    if (String(req.user?.id) === String(id)) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const doc = await User.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('ADMIN_DELETE_USER_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Update role */
router.patch('/users/:id/role', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};
    const allowedRoles = ['admin', 'operator', 'candidate', 'user'];
    if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    // Prevent changing your own role
    if (String(req.user?.id) === String(id) && req.user.role !== role) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true, projection: 'username role allowedDatabaseIds' }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    console.error('ADMIN_UPDATE_ROLE_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Update password */
router.patch('/users/:id/password', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { password = '' } = req.body || {};
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(
      id,
      { passwordHash },
      { new: true, projection: 'username role allowedDatabaseIds' }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('ADMIN_UPDATE_PASSWORD_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Update allowed DB access */
router.patch('/users/:id/databases', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    let { allowedDatabaseIds = [] } = req.body || {};
    if (!Array.isArray(allowedDatabaseIds)) allowedDatabaseIds = [];

    // Validate against available DB list (best-effort)
    try {
      const available = await listVoterDatabases();
      const validIds = new Set(available.map(db => db.id));
      allowedDatabaseIds = allowedDatabaseIds
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(v => v && validIds.has(v));
    } catch {
      // If list fails, you can still save as-is; comment out next line to allow.
      // (Keeping strict to avoid typos)
      // allowedDatabaseIds = [];
    }

    const user = await User.findByIdAndUpdate(
      id,
      { allowedDatabaseIds },
      { new: true, projection: 'username role allowedDatabaseIds' }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    console.error('ADMIN_UPDATE_DATABASES_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
