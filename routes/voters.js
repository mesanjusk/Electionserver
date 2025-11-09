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
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function buildMobileUpdate(normalizedMobile) {
  if (!normalizedMobile) return null;
  return {
    mobile: normalizedMobile,
    Mobile: normalizedMobile,
    phone: normalizedMobile,
    Phone: normalizedMobile,
    contact: normalizedMobile,
    Contact: normalizedMobile,
    '__raw.Mobile': normalizedMobile,
    '__raw.Mobile No': normalizedMobile,
    '__raw.मोबाइल': normalizedMobile,
    '__raw.Contact': normalizedMobile,
  };
}

function pickMobileCandidate(body = {}) {
  const candidates = ['mobile', 'Mobile', 'phone', 'Phone', 'contact', 'Contact'];
  for (const key of candidates) {
    if (body[key] !== undefined && body[key] !== null) {
      return body[key];
    }
  }
  return null;
}

async function applyMobileUpdate(query, body) {
  const candidate = pickMobileCandidate(body);
  if (candidate === null) {
    return { status: 400, error: 'Mobile number is required' };
  }

  const normalized = normalizeMobileNumber(candidate);
  if (!normalized) {
    return { status: 400, error: 'Invalid mobile number' };
  }

  const set = buildMobileUpdate(normalized);
  const updated = await Voter.findOneAndUpdate(query, { $set: set }, { new: true, lean: true });
  if (!updated) {
    return { status: 404, error: 'Voter not found' };
  }

  return { status: 200, data: updated };
}

router.patch('/by-epic/:epic', auth, requireAuth, async (req, res) => {
  try {
    const epic = req.params.epic;
    if (!epic) {
      res.status(400).json({ error: 'EPIC is required' });
      return;
    }
    const query = {
      $or: [
        { voter_id: epic },
        { EPIC: epic },
        { '__raw.EPIC': epic },
        { '__raw.कार्ड नं': epic },
      ],
    };
    const result = await applyMobileUpdate(query, req.body);
    if (result.error) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', auth, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await applyMobileUpdate({ _id: id }, req.body);
    if (result.error) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
