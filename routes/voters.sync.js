// server/routes/voters.sync.js
import { Router } from 'express';
import { resolveVoterModelForRequest } from '../lib/voterDatabases.js';
import { auth } from '../middleware/auth.js';
import { requireAuth } from '../middleware/roles.js';

const router = Router();

// GET /api/voters/export?page=1&limit=5000&since=ISO
// Requires databaseId when multiple databases are assigned to the user.
router.get('/export', auth, requireAuth, async (req, res) => {
  try {
    const ctx = resolveVoterModelForRequest(req, res);
    if (!ctx) return;
    const { model: VoterModel, databaseId } = ctx;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '5000', 10), 1), 20000);
    const skip = (page - 1) * limit;

    const since = req.query.since ? new Date(req.query.since) : null;
    const filter = since ? { updatedAt: { $gt: since } } : {};

    const [items, count] = await Promise.all([
      VoterModel.find(filter).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
      VoterModel.countDocuments(filter),
    ]);

    const hasMore = skip + items.length < count;
    const serverTime = new Date().toISOString();

    res.json({ items, hasMore, serverTime, page, count, databaseId });
  } catch (e) {
    console.error('export error', e);
    res.status(500).json({ error: 'export_failed' });
  }
});

// POST /api/voters/bulk-upsert
// { databaseId?, changes: [{_id, op: "upsert", payload: {...}, updatedAt}] }
router.post('/bulk-upsert', auth, requireAuth, async (req, res) => {
  try {
    const ctx = resolveVoterModelForRequest(req, res, { requireExplicitSelection: true });
    if (!ctx) return;
    const { model: VoterModel, databaseId } = ctx;

    const { changes } = req.body || {};
    if (!Array.isArray(changes) || !changes.length) {
      return res.json({ successIds: [], failed: [] });
    }

    const successIds = [];
    const failed = [];

    for (const ch of changes) {
      try {
        const { _id, op, payload, updatedAt } = ch;
        if (!(_id && op === 'upsert')) { failed.push({ _id, reason: 'bad_change' }); continue; }

        const doc = await VoterModel.findById(_id);
        if (!doc) {
          await VoterModel.create({ _id, ...(payload || {}) });
          successIds.push(_id);
          continue;
        }
        const remoteTime = new Date(doc.updatedAt || 0).getTime();
        const localTime = new Date(updatedAt || 0).getTime();
        if (!Number.isNaN(localTime) && localTime >= remoteTime) {
          Object.assign(doc, payload || {});
          await doc.save();
        }
        successIds.push(_id);
      } catch (e) {
        console.error('upsert fail', e);
        failed.push({ _id: ch._id, reason: 'exception' });
      }
    }

    res.json({ successIds, failed, databaseId });
  } catch (e) {
    console.error('bulk-upsert error', e);
    res.status(500).json({ error: 'bulk_upsert_failed' });
  }
});

export default router;
