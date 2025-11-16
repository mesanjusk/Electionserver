// server/routes/admin.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listVoterDatabases,
  cloneVoterCollection,
  dropVoterCollection,
} from '../models/Voter.js';
import Party from "../models/Party.js";   // ⬅️ add on top


const router = Router();

function serializeUser(user, overrides = {}) {
  if (!user) return null;
  const plain =
    typeof user.toObject === 'function' ? user.toObject() : user;

  const rawId = plain._id || plain.id || null;

  const base = {
    id: rawId ? String(rawId) : undefined,
    _id: plain._id,
    username: plain.username || '',
    role: plain.role || 'user',
    allowedDatabaseIds: Array.isArray(plain.allowedDatabaseIds)
      ? plain.allowedDatabaseIds
      : [],
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,

    // extra fields for AdminUsers.jsx
    avatarUrl: plain.avatarUrl || null,
    maxVolunteers:
      typeof plain.maxVolunteers === 'number' ? plain.maxVolunteers : 0,
    parentUserId: plain.parentUserId || null,
    parentUsername: plain.parentUsername || '',
    deviceIdBound: plain.deviceIdBound || null,
    deviceBoundAt: plain.deviceBoundAt || null,
    enabled:
      typeof plain.enabled === 'boolean' ? plain.enabled : true,

    // 🔹 Political party info
    partyId: plain.partyId || null,
    partyName: plain.partyName || '',

    // will be overridden by list route
    volunteerCount:
      typeof plain.volunteerCount === 'number' ? plain.volunteerCount : 0,
  };

  return { ...base, ...overrides };
}

/** Get list of voter DBs to assign (only master DBs, no per-user clones) */
router.get(
  '/databases',
  auth,
  requireRole('admin'),
  async (_req, res) => {
    try {
      const databases = await listVoterDatabases(); // [{ id, name }]
      // Filter out per-user cloned DBs (we name them "u_<userKey>_<master>")
      const filtered = databases.filter((db) => {
        const id = String(db.id || db.collection || '');
        return !id.startsWith('u_');
      });
      res.json({ databases: filtered });
    } catch (e) {
      console.error('ADMIN_DATABASES_ERROR', e);
      // return an empty array instead of 500 to avoid blocking the UI
      res.json({ databases: [] });
    }
  }
);

// GET all political parties
router.get("/parties", async (req, res) => {
  try {
    const parties = await Party.find({}).lean();
    res.json(parties);
  } catch (err) {
    res.status(500).json({ error: "Failed to load parties" });
  }
});



/** List users (with volunteer counts, avatars, device info, enabled flag) */
router.get('/users', auth, requireRole('admin'), async (_req, res) => {
  try {
    // Base user docs
    const users = await User.find(
      {},
      'username role allowedDatabaseIds createdAt updatedAt avatarUrl maxVolunteers parentUserId parentUsername deviceIdBound deviceBoundAt enabled partyId partyName'
    ).sort({ createdAt: -1 });

    // Compute volunteer counts: how many users reference each parentUserId
    const volunteerCountsRaw = await User.aggregate([
      { $match: { parentUserId: { $ne: null } } },
      { $group: { _id: '$parentUserId', count: { $sum: 1 } } },
    ]);

    const volunteerCountsMap = {};
    for (const row of volunteerCountsRaw) {
      volunteerCountsMap[String(row._id)] = row.count;
    }

    const serialized = users.map((u) =>
      serializeUser(u, {
        volunteerCount: volunteerCountsMap[String(u._id)] || 0,
      })
    );

    res.json({ users: serialized });
  } catch (e) {
    console.error('ADMIN_LIST_USERS_ERROR', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Create user (username required; role; allowed DBs; avatar; volunteers; per-user DBs) */
router.post('/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const {
      username,
      password,
      role = 'user',
      allowedDatabaseIds = [],
      avatarUrl = null,
      maxVolunteers,
      parentUserId,
      parentUsername,

      // 🔹 NEW: political party info coming from frontend
      partyId,
      partyName,
    } = req.body || {};

    const normalizedUsername =
      typeof username === 'string' ? username.trim() : '';
    if (!normalizedUsername) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({
        error: 'Password must be at least 4 characters long.',
      });
    }

    const normalizedRole =
      typeof role === 'string' ? role.trim().toLowerCase() : 'user';
    const allowedRoles = [
      'admin',
      'operator',
      'candidate',
      'user',
      'volunteer',
    ];
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Prevent duplicate usernames
    const existingUser = await User.findOne({
      username: normalizedUsername.toLowerCase(),
    });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Validate DB IDs (best-effort)
    let requestedDbIds = [];
    if (
      Array.isArray(allowedDatabaseIds) &&
      allowedDatabaseIds.length > 0
    ) {
      try {
        const available = await listVoterDatabases();
        const validIds = new Set(available.map((db) => db.id));
        requestedDbIds = Array.from(
          new Set(
            allowedDatabaseIds
              .map((id) =>
                typeof id === 'string' ? id.trim() : ''
              )
              .filter((id) => id && validIds.has(id))
          )
        );
      } catch {
        requestedDbIds = Array.from(
          new Set(
            allowedDatabaseIds
              .map((id) =>
                typeof id === 'string' ? id.trim() : ''
              )
              .filter(Boolean)
          )
        );
      }
    }

    // Parse maxVolunteers for NON-volunteer accounts
    let parsedMaxVolunteers = 0;
    if (
      normalizedRole !== 'volunteer' &&
      maxVolunteers !== undefined &&
      maxVolunteers !== null &&
      maxVolunteers !== ''
    ) {
      const n = Number(maxVolunteers);
      if (!Number.isNaN(n) && n >= 0) {
        parsedMaxVolunteers = Math.min(n, 50); // safety hard-cap
      }
    }

    // If this is a volunteer account, enforce parent capacity
    let finalParentUserId = null;
    let finalParentUsername = '';

    if (normalizedRole === 'volunteer' && parentUserId) {
      const parent = await User.findById(parentUserId);
      if (!parent) {
        return res
          .status(400)
          .json({ error: 'Parent user not found' });
      }

      const maxVol =
        typeof parent.maxVolunteers === 'number'
          ? parent.maxVolunteers
          : 0;

      if (maxVol > 0) {
        const used = await User.countDocuments({
          parentUserId: parent._id,
        });
        if (used >= maxVol) {
          return res
            .status(400)
            .json({ error: 'Volunteer limit reached for this account' });
        }
      }

      finalParentUserId = parent._id;
      finalParentUsername = parentUsername || parent.username || '';
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // 🔹 VOLUNTEER: inherit parent's already-cloned DBs as-is
    if (normalizedRole === 'volunteer') {
      const user = await User.create({
        username: normalizedUsername.toLowerCase(),
        passwordHash,
        role: normalizedRole,
        allowedDatabaseIds: requestedDbIds, // these are cloned DB IDs from parent
        avatarUrl: avatarUrl || null,
        maxVolunteers: 0,
        parentUserId: finalParentUserId,
        parentUsername: finalParentUsername,
        enabled: true,

        // store party on volunteer too (same as parent candidate)
        partyId: partyId || null,
        partyName: partyName || '',
      });

      return res.status(201).json({ user: serializeUser(user) });
    }

    // 🔹 NON-VOLUNTEER (candidate/user/operator/admin):
    // Create the user first with no DBs, then clone master DBs into per-user DBs.
    const user = await User.create({
      username: normalizedUsername.toLowerCase(),
      passwordHash,
      role: normalizedRole,
      allowedDatabaseIds: [],
      avatarUrl: avatarUrl || null,
      maxVolunteers: parsedMaxVolunteers,
      parentUserId: finalParentUserId,
      parentUsername: finalParentUsername,
      enabled: true,

      // store party for main user / candidate
      partyId: partyId || null,
      partyName: partyName || '',
    });

    const clonedDbIds = [];

    // use username instead of raw Mongo _id in cloned DB id
    const rawKey = user.username || user._id;
    const safeKey =
      String(rawKey)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '') || String(user._id);

    for (const masterId of requestedDbIds) {
      const cleanMaster =
        typeof masterId === 'string'
          ? masterId.replace(/\s+/g, '')
          : String(masterId);
      const targetId = `u_${safeKey}_${cleanMaster}`;
      try {
        await cloneVoterCollection(masterId, targetId);
        clonedDbIds.push(targetId);
      } catch (err) {
        console.error(
          'CLONE_VOTER_COLLECTION_ERROR',
          masterId,
          '->',
          targetId,
          err.message
        );
      }
    }

    if (clonedDbIds.length) {
      user.allowedDatabaseIds = clonedDbIds;
      await user.save();
    }

    return res.status(201).json({ user: serializeUser(user) });
  } catch (e) {
    console.error('ADMIN_CREATE_USER_ERROR', e);

    // Always surface username conflict to the client
    if (e?.code === 11000 || /E11000/.test(e?.message || '')) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    if (e?.name === 'ValidationError') {
      const message =
        typeof e?.message === 'string'
          ? e.message
          : 'Validation failed';
      return res.status(400).json({ error: message });
    }

    res.status(500).json({ error: 'Server error' });
  }
});

/** Delete user + their volunteers + their private DBs */
router.delete(
  '/users/:id',
  auth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (String(req.user?.id) === String(id)) {
        return res
          .status(400)
          .json({ error: 'You cannot delete your own account' });
      }

      const user = await User.findById(id);
      if (!user)
        return res.status(404).json({ error: 'User not found' });

      // If this is a PARENT (non-volunteer), drop their cloned DBs and delete volunteers
      if (user.role !== 'volunteer') {
        const clonedDbIds = Array.isArray(user.allowedDatabaseIds)
          ? user.allowedDatabaseIds
          : [];

        // Delete volunteers first
        await User.deleteMany({ parentUserId: user._id });

        // Drop per-user voter collections
        for (const col of clonedDbIds) {
          if (!col) continue;
          try {
            await dropVoterCollection(col);
          } catch (err) {
            console.error(
              'DROP_USER_DB_ERROR',
              col,
              err.message
            );
          }
        }
      }

      await User.findByIdAndDelete(user._id);

      res.json({ ok: true });
    } catch (e) {
      console.error('ADMIN_DELETE_USER_ERROR', e);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** Update role */
router.patch(
  '/users/:id/role',
  auth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body || {};
      const normalizedRole =
        typeof role === 'string' ? role.trim().toLowerCase() : '';
      const allowedRoles = [
        'admin',
        'operator',
        'candidate',
        'user',
        'volunteer',
      ];
      if (!allowedRoles.includes(normalizedRole)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      if (
        String(req.user?.id) === String(id) &&
        req.user.role !== normalizedRole
      ) {
        return res.status(400).json({
          error: 'You cannot change your own role',
        });
      }

      const user = await User.findByIdAndUpdate(
        id,
        { role: normalizedRole },
        {
          new: true,
          projection:
            'username role allowedDatabaseIds avatarUrl maxVolunteers parentUserId parentUsername deviceIdBound deviceBoundAt enabled partyId partyName',
        }
      );
      if (!user)
        return res.status(404).json({ error: 'User not found' });

      // recompute volunteerCount for this user
      const used = await User.countDocuments({
        parentUserId: user._id,
      });

      res.json({
        user: serializeUser(user, { volunteerCount: used }),
      });
    } catch (e) {
      console.error('ADMIN_UPDATE_ROLE_ERROR', e);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** Update password */
router.patch(
  '/users/:id/password',
  auth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password = '' } = req.body || {};
      if (!password || typeof password !== 'string' || password.length < 4) {
        return res.status(400).json({
          error: 'Password must be at least 4 characters long.',
        });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.findByIdAndUpdate(
        id,
        { passwordHash },
        {
          new: true,
          projection:
            'username role allowedDatabaseIds avatarUrl maxVolunteers parentUserId parentUsername deviceIdBound deviceBoundAt enabled partyId partyName',
        }
      );
      if (!user)
        return res.status(404).json({ error: 'User not found' });
      res.json({ ok: true });
    } catch (e) {
      console.error('ADMIN_UPDATE_PASSWORD_ERROR', e);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** Update allowed DB access (for existing per-user DBs – no cloning here) */
router.patch(
  '/users/:id/databases',
  auth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      let { allowedDatabaseIds = [] } = req.body || {};
      if (!Array.isArray(allowedDatabaseIds)) allowedDatabaseIds = [];

      // Best-effort validation: any existing collection is allowed
      try {
        const available = await listVoterDatabases();
        const validIds = new Set(available.map((db) => db.id));
        allowedDatabaseIds = allowedDatabaseIds
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => v && validIds.has(v));
      } catch {
        // keep as-is on failure
      }

      const user = await User.findByIdAndUpdate(
        id,
        { allowedDatabaseIds },
        {
          new: true,
          projection:
            'username role allowedDatabaseIds avatarUrl maxVolunteers parentUserId parentUsername deviceIdBound deviceBoundAt enabled partyId partyName',
        }
      );
      if (!user)
        return res.status(404).json({ error: 'User not found' });

      const used = await User.countDocuments({
        parentUserId: user._id,
      });

      res.json({
        user: serializeUser(user, { volunteerCount: used }),
      });
    } catch (e) {
      console.error('ADMIN_UPDATE_DATABASES_ERROR', e);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** Combined PUT (role + DBs in one call) */
router.put('/users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    let { role, databaseIds, allowedDatabaseIds } = req.body || {};

    if (typeof role === 'string') {
      role = role.toLowerCase();
    }
    const allowedRoles = new Set([
      'admin',
      'operator',
      'candidate',
      'user',
      'volunteer',
    ]);
    if (!allowedRoles.has(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    let finalDbIds = Array.isArray(allowedDatabaseIds)
      ? allowedDatabaseIds
      : databaseIds;
    if (!Array.isArray(finalDbIds)) finalDbIds = [];

    // Best-effort validation
    try {
      const available = await listVoterDatabases();
      const valid = new Set(available.map((d) => d.id));
      finalDbIds = finalDbIds
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v && valid.has(v));
    } catch {
      // keep as-is
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { role, allowedDatabaseIds: finalDbIds } },
      {
        new: true,
        projection:
          'username role allowedDatabaseIds avatarUrl maxVolunteers parentUserId parentUsername deviceIdBound deviceBoundAt enabled partyId partyName',
      }
    );
    if (!user)
      return res.status(404).json({ error: 'User not found' });

    const used = await User.countDocuments({
      parentUserId: user._id,
    });

    const serialized = serializeUser(user, {
      volunteerCount: used,
    });
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

/** Reset device binding for a user (used by AdminUsers.jsx) */
router.patch(
  '/users/:id/reset-device',
  auth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await User.findById(id);
      if (!user)
        return res.status(404).json({ error: 'User not found' });

      if (Array.isArray(user.deviceHistory)) {
        user.deviceHistory.push({
          action: 'RESET',
          by: req.user?.id || 'admin',
        });
      } else {
        user.deviceHistory = [
          { action: 'RESET', by: req.user?.id || 'admin' },
        ];
      }

      user.deviceIdBound = null;
      user.deviceBoundAt = null;
      await user.save();

      const used = await User.countDocuments({
        parentUserId: user._id,
      });

      res.json({
        user: serializeUser(user, { volunteerCount: used }),
      });
    } catch (e) {
      console.error('ADMIN_RESET_DEVICE_ERROR', e);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** Enable / disable a user (and all their volunteers) */
router.patch(
  '/users/:id/enabled',
  auth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body || {};
      const flag = !!enabled;

      // Prevent disabling your own admin account (optional safeguard)
      if (String(req.user?.id) === String(id) && !flag) {
        return res.status(400).json({
          error: 'You cannot disable your own account',
        });
      }

      const user = await User.findById(id);
      if (!user)
        return res.status(404).json({ error: 'User not found' });

      user.enabled = flag;
      await user.save();

      // If this is a parent, propagate enabled flag to its volunteers
      if (user.role !== 'volunteer') {
        await User.updateMany(
          { parentUserId: user._id },
          { $set: { enabled: flag } }
        );
      }

      const used = await User.countDocuments({
        parentUserId: user._id,
      });

      res.json({
        user: serializeUser(user, { volunteerCount: used }),
      });
    } catch (e) {
      console.error('ADMIN_ENABLE_USER_ERROR', e);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** Update avatar / volunteer limit (profile config) */
router.patch(
  '/users/:id/profile',
  auth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { avatarUrl, maxVolunteers } = req.body || {};

      const user = await User.findById(id);
      if (!user)
        return res.status(404).json({ error: 'User not found' });

      // avatar update
      if (typeof avatarUrl === 'string') {
        user.avatarUrl = avatarUrl || null;
      }

      // volunteer limit update (only for non-volunteer parent accounts)
      if (maxVolunteers !== undefined && user.role !== 'volunteer') {
        const n = Number(maxVolunteers);
        if (!Number.isNaN(n) && n >= 0) {
          const safeLimit = Math.min(n, 50);
          const used = await User.countDocuments({
            parentUserId: user._id,
          });
          if (safeLimit < used) {
            return res.status(400).json({
              error: `Cannot set volunteers limit below currently used count (${used}).`,
            });
          }
          user.maxVolunteers = safeLimit;
        }
      }

      await user.save();

      const used = await User.countDocuments({
        parentUserId: user._id,
      });

      res.json({
        user: serializeUser(user, { volunteerCount: used }),
      });
    } catch (e) {
      console.error('ADMIN_UPDATE_PROFILE_ERROR', e);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;
