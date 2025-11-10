// server/routes/voters.js
import { Router } from 'express';
import Voter from '../models/Voter.js';
import { auth } from '../middleware/auth.js';
import { requireAuth } from '../middleware/roles.js';

const router = Router();

/* ----------------------------- helpers ----------------------------- */
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseFilters(qs) {
  // supports both ?filters[Booth]=12 and ?filters={"Booth":"12"}
  const filters = {};
  // object style
  if (qs.filters && typeof qs.filters === 'object') {
    for (const [k, v] of Object.entries(qs.filters)) {
      if (v !== undefined && v !== '') filters[k] = v;
    }
  }
  // flattened style
  for (const [k, v] of Object.entries(qs)) {
    const m = /^filters\[(.+?)\]$/.exec(k);
    if (m && v !== undefined && v !== '') filters[m[1]] = v;
  }
  return filters;
}

function normalizeMobileNumber(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function pickMobileCandidate(body = {}) {
  const candidates = ['mobile', 'Mobile', 'phone', 'Phone', 'contact', 'Contact'];
  for (const key of candidates) {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== '') {
      return body[key];
    }
  }
  // also allow { value: "..." } from minimal UIs
  if (body.value !== undefined && body.value !== null) return body.value;
  return null;
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
    // common raw variants we’ve seen in imports
    '__raw.Mobile': normalizedMobile,
    '__raw.Mobile No': normalizedMobile,
    '__raw.मोबाइल': normalizedMobile,
    '__raw.Contact': normalizedMobile,
  };
}

function safeProjectionFromCSV(csv) {
  if (!csv) return null;
  const out = {};
  String(csv)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(k => { out[k] = 1; });
  // we nearly always want raw for UI labels; include unless explicitly excluded
  out.__raw = 1;
  return out;
}

function buildSearchQuery(q, filters) {
  const query = { ...filters };
  if (!q) return query;

  const rx = new RegExp(esc(q), 'i');
  query.$or = [
    // canonical
    { name: rx }, { Name: rx },
    { voter_id: rx }, { EPIC: rx },
    // phones
    { mobile: rx }, { Mobile: rx },
    { phone: rx },  { Phone: rx },
    { contact: rx }, { Contact: rx },
    // raw fallbacks (NOTE: do NOT use "__raw['…']" form; dot-path is correct)
    { '__raw.Name': rx },
    { '__raw.नाव': rx },
    { '__raw.नाव + मोबा/ ईमेल नं.': rx },
    { '__raw.EPIC': rx },
    { '__raw.voter_id': rx },
    { '__raw.कार्ड नं': rx },
    { '__raw.Mobile': rx },
    { '__raw.Mobile No': rx },
    { '__raw.मोबाइल': rx },
    { '__raw.Contact': rx },
    { Booth: rx }, { '__raw.Booth': rx },
  ];
  return query;
}

async function applyMobileUpdate(matchQuery, body) {
  const candidate = pickMobileCandidate(body);
  if (candidate === null) return { status: 400, error: 'Mobile number is required' };

  const normalized = normalizeMobileNumber(candidate);
  if (!normalized) return { status: 400, error: 'Invalid mobile number' };

  const $set = {
    ...buildMobileUpdate(normalized),
    updatedAt: new Date(),
  };

  const doc = await Voter.findOneAndUpdate(matchQuery, { $set }, { new: true, lean: true });
  if (!doc) return { status: 404, error: 'Voter not found' };
  return { status: 200, data: doc };
}

/* ------------------------------- routes ------------------------------- */

/**
 * GET /api/voters/search
 * q= string                 (regex search on name, voter_id, phones, plus __raw fallbacks)
 * page= number>=1           (default 1)
 * limit= number<=100        (default 20)
 * filters[field]=value      (generic equals filter for any field)
 * fields=name,voter_id,...  (optional CSV for projection)
 */
router.get('/search', auth, requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const filters = parseFilters(req.query);
    const findQuery = buildSearchQuery(q, filters);

    const projection = safeProjectionFromCSV(req.query.fields);

    const [results, total] = await Promise.all([
      Voter.find(findQuery)
        .select(projection ? projection : '-__v')
        .skip(skip)
        .limit(limit)
        .lean(),
      Voter.countDocuments(findQuery),
    ]);

    res.json({
      results,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) {
    console.error('Search error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/voters/all
 * Loads ALL voter records (no pagination). Optional q= and filters=.
 * WARNING: for very large datasets, prefer /search with paging.
 */
router.get('/all', auth, requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filters = parseFilters(req.query);
    const projection = safeProjectionFromCSV(req.query.fields) || undefined;

    const findQuery = buildSearchQuery(q, filters);

    // Optional hard cap to prevent accidental OOM in cloud; lift if you need
    const HARD_CAP = parseInt(process.env.VOTERS_ALL_HARDCAP || '0', 10); // 0 = no cap
    let cursor = Voter.find(findQuery, projection).lean();
    if (HARD_CAP > 0) cursor = cursor.limit(HARD_CAP);

    const docs = await cursor.exec();
    res.json({ total: docs.length, results: docs });
  } catch (e) {
    console.error('All error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/voters/by-epic/:epic
 * Body can contain any of: { mobile | Mobile | phone | Phone | contact | Contact | value }
 */
router.patch('/by-epic/:epic', auth, requireAuth, async (req, res) => {
  try {
    const epic = String(req.params.epic || '').trim();
    if (!epic) return res.status(400).json({ error: 'EPIC is required' });

    // EPIC variants in different imports
    const match = {
      $or: [
        { voter_id: epic },
        { EPIC: epic },
        { '__raw.EPIC': epic },
        { '__raw.कार्ड नं': epic },
      ],
    };

    const result = await applyMobileUpdate(match, req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.data);
  } catch (e) {
    console.error('by-epic patch error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/voters/:id
 * Body can contain any of: { mobile | Mobile | phone | Phone | contact | Contact | value }
 */
router.patch('/:id', auth, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await applyMobileUpdate({ _id: id }, req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.data);
  } catch (e) {
    console.error('id patch error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
