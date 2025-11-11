// lib/voterDatabases.js
import { getDefaultVoterCollection, getVoterModel, listVoterDatabases } from '../models/Voter.js';

function sanitizeDatabaseId(id) {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!value) return '';
  if (value.startsWith('system.')) return '';
  if (value.includes('\0')) return '';
  return value;
}

export function extractDatabaseId(req) {
  if (!req) return '';
  const candidates = [
    req.params?.databaseId,
    req.query?.databaseId,
    req.query?.database,
    req.query?.collection,
    req.body?.databaseId,
    req.body?.collection,
  ];

  for (const candidate of candidates) {
    const sanitized = sanitizeDatabaseId(candidate);
    if (sanitized) return sanitized;
  }
  return '';
}

function getAllowedDatabasesFromUser(user) {
  if (!user) return [];
  if (!Array.isArray(user.allowedDatabaseIds)) return [];
  return user.allowedDatabaseIds.map(id => sanitizeDatabaseId(id)).filter(Boolean);
}

export function resolveVoterModelForRequest(req, res, options = {}) {
  const { requireExplicitSelection = false } = options;
  const allowed = getAllowedDatabasesFromUser(req.user);
  const isAdmin = req.user?.role === 'admin';

  let requested = sanitizeDatabaseId(extractDatabaseId(req));

  if (!requested) {
    if (allowed.length > 1 || requireExplicitSelection) {
      res.status(400).json({ error: 'Please choose a voter database (databaseId).' });
      return null;
    }
    if (allowed.length === 1) {
      requested = allowed[0];
    }
  }

  if (!requested) {
    requested = sanitizeDatabaseId(getDefaultVoterCollection());
  }

  if (!requested) {
    res.status(400).json({ error: 'databaseId is required.' });
    return null;
  }

  if (allowed.length && !allowed.includes(requested) && !isAdmin) {
    res.status(403).json({ error: 'You do not have access to this voter database.' });
    return null;
  }

  try {
    const model = getVoterModel(requested);
    return { model, databaseId: requested };
  } catch (e) {
    console.error('VOTER_MODEL_RESOLVE_ERROR', e);
    res.status(500).json({ error: 'Unable to open the selected voter database.' });
    return null;
  }
}

export { listVoterDatabases };
