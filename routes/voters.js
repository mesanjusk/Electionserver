// server/routes/voters.js
import { Router } from 'express';
import Voter from '../models/Voter.js';
import { auth } from '../middleware/auth.js';
import { requireAuth } from '../middleware/roles.js';

const router = Router();

/**
 * GET /api/voters/search
 * q= string           (text / regex search on name, voter_id, text index)
 * page= number>=1     (default 1)
 * limit= number<=100  (default 20)
 * filters[field]=value   generic equals filter for any field (e.g., filters[Booth]=12)
 * fields=name,voter_id,Booth   optional CSV for projection
 */
router.get('/search', auth, requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    // Generic filters: filters[field]=value
    const filters = {};
    // URLSearchParams flattens; but Express gives object: { 'filters[field]': 'value' } OR filters: { field: value }
    if (req.query.filters && typeof req.query.filters === 'object') {
      for (const [k, v] of Object.entries(req.query.filters)) {
        if (v !== undefined && v !== '') filters[k] = v;
      }
    }

    // Base query with filters
    const query = { ...filters };

    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      Object.assign(query, {
        $or: [
          { name: regex },
          { voter_id: regex },
          { $text: { $search: q } },
        ],
      });
    }

    const projection = {};
    if (req.query.fields) {
      const fields = String(req.query.fields).split(',').map(s => s.trim()).filter(Boolean);
      for (const f of fields) projection[f] = 1;
      projection.__raw = 1; // always keep raw for UI details
    }

    const [rows, total] = await Promise.all([
      Voter.find(query).select(Object.keys(projection).length ? projection : '-__v').skip(skip).limit(limit).lean(),
      Voter.countDocuments(query),
    ]);

    res.json({
      results: rows,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

function normalizeMobileNumber(value) {
  if (!value) return '';
  const digits = String(value).replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function buildMobileUpdate(mobile) {
  const normalized = normalizeMobileNumber(mobile);
  if (!normalized) return null;
  const set = {
    mobile: normalized,
    Mobile: normalized,
    phone: normalized,
    Phone: normalized,
    contact: normalized,
    Contact: normalized,
    '__raw.Mobile': normalized,
    '__raw.Mobile No': normalized,
    '__raw.मोबाइल': normalized,
    '__raw.Contact': normalized,
  };
  return set;
}

async function updateMobileByQuery(query, mobile, res) {
  const set = buildMobileUpdate(mobile);
  if (!set) {
    res.status(400).json({ error: 'Invalid mobile number' });
    return;
  }

  const updated = await Voter.findOneAndUpdate(query, { $set: set }, { new: true, lean: true });
  if (!updated) {
    res.status(404).json({ error: 'Voter not found' });
    return;
  }

  res.json(updated);
}

router.patch('/by-epic/:epic', auth, requireAuth, async (req, res) => {
  try {
    const epic = req.params.epic;
    if (!epic) {
      res.status(400).json({ error: 'EPIC is required' });
      return;
    }
    await updateMobileByQuery({ voter_id: epic }, req.body?.mobile ?? req.body?.Mobile ?? req.body?.phone ?? req.body?.Phone, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', auth, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await updateMobileByQuery({ _id: id }, req.body?.mobile ?? req.body?.Mobile ?? req.body?.phone ?? req.body?.Phone, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
