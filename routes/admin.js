// server/routes/admin.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { listVoterDatabases } from '../lib/voterDatabases.js';

const router = Router();

function serializeUser(user) {
  if (!user) return null;
  const plain = typeof user.toObject === 'function' ? user.toObject() : user;
  const rawId = plain._id || plain.id || null;
  return {
    id: rawId ? String(rawId) : undefined,
    _id: plain._id,
    username: plain.username || '',
    role: plain.role || 'user',
    allowedDatabaseIds: Array.isArray(plain.allowedDatabaseIds) ? plain.allowedDatabaseIds : [],
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
}

/** Get list of voter DBs to assign */
router.get('/databases', auth, requireRole('admin'), async (_req, res) => {
  try {
    const databases = await listVoterDatabases(); // [{ id, name }]
    res.json({ databases });
  } catch (e) {
    console.error('ADMIN_DATABASES_ERROR', e);
    // return an empty array instead of 500 to avoid blocking the UI
    res.json({ databases: [] });
  }
});

/** List users (lightweight) */
router.get('/users', auth, requireRole('admin'), async (_req, res) => {
  try {
    const users = await User.find({}, 'username role allowedDatabaseIds createdAt updatedAt')
      .sort({ createdAt: -1 });
    res.json({ users: users.map(serializeUser) });
  } catch (e) {
    console.error('ADMIN_LIST_USERS_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Create user (username required; role; allowed DBs); no email anywhere */
router.post('/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const {
      username,
      password,
      role = 'user',
      allowedDatabaseIds = [],
    } = req.body || {};

    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (!normalizedUsername) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
    }

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : 'user';
    const roleAlias = normalizedRole === 'volunteer' ? 'operator' : normalizedRole;
    const allowedRoles = ['admin', 'operator', 'candidate', 'user'];
    if (!allowedRoles.includes(roleAlias)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Prevent duplicate usernames
    const existingUser = await User.findOne({ username: normalizedUsername });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Validate DB IDs against available list (best-effort)
    let finalAllowed = [];
    if (Array.isArray(allowedDatabaseIds) && allowedDatabaseIds.length > 0) {
      try {
        const available = await listVoterDatabases();
        const validIds = new Set(available.map(db => db.id));
        finalAllowed = Array.from(new Set(
          allowedDatabaseIds
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(id => id && validIds.has(id))
        ));
      } catch {
        // If listing fails, just keep the provided values (deduped + truthy)
        finalAllowed = Array.from(new Set(allowedDatabaseIds.filter(Boolean)));
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: normalizedUsername,
      passwordHash,
      role: roleAlias,
      allowedDatabaseIds: finalAllowed,
    });

    res.status(201).json({ user: serializeUser(user) });
  } catch (e) {
    console.error('ADMIN_CREATE_USER_ERROR', e);

    // Always surface username conflict to the client (avoid "Email already exists")
    if (e?.code === 11000 || /E11000/.test(e?.message || '')) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    if (e?.name === 'ValidationError') {
      const message = typeof e?.message === 'string' ? e.message : 'Validation failed';
      return res.status(400).json({ error: message });
    }

    res.status(500).json({ error: 'Server error' });
  }
});

/** Delete user */
router.delete('/users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
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
    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    const roleAlias = normalizedRole === 'volunteer' ? 'operator' : normalizedRole;
    const allowedRoles = ['admin', 'operator', 'candidate', 'user'];
    if (!allowedRoles.includes(roleAlias)) return res.status(400).json({ error: 'Invalid role' });

    if (String(req.user?.id) === String(id) && req.user.role !== roleAlias) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role: roleAlias },
      { new: true, projection: 'username role allowedDatabaseIds' }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: serializeUser(user) });
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

    // Best-effort validation
    try {
      const available = await listVoterDatabases();
      const validIds = new Set(available.map(db => db.id));
      allowedDatabaseIds = allowedDatabaseIds
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(v => v && validIds.has(v));
    } catch {
      // keep as-is on failure
    }

    const user = await User.findByIdAndUpdate(
      id,
      { allowedDatabaseIds },
      { new: true, projection: 'username role allowedDatabaseIds' }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: serializeUser(user) });
  } catch (e) {
    console.error('ADMIN_UPDATE_DATABASES_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Combined PUT (role + DBs in one call) */
router.put('/users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    let { role, databaseIds, allowedDatabaseIds } = req.body || {};

    if (typeof role === 'string') {
      const r = role.toLowerCase();
      role = r === 'volunteer' ? 'operator' : r;
    }
    const allowedRoles = new Set(['admin', 'operator', 'candidate', 'user']);
    if (!allowedRoles.has(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    let finalDbIds = Array.isArray(allowedDatabaseIds) ? allowedDatabaseIds : databaseIds;
    if (!Array.isArray(finalDbIds)) finalDbIds = [];

    // Best-effort validation
    try {
      const available = await listVoterDatabases();
      const valid = new Set(available.map(d => d.id));
      finalDbIds = finalDbIds
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(v => v && valid.has(v));
    } catch {
      // keep as-is
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { role, allowedDatabaseIds: finalDbIds } },
      { new: true, projection: 'username role allowedDatabaseIds' }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const serialized = serializeUser(user);
    res.json({
      user: {
        ...serialized,
        databaseIds: serialized.allowedDatabaseIds, // backward compat
      },
    });
  } catch (e) {
    console.error('ADMIN_UPSERT_USER_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
