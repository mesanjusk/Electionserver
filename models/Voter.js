// server/models/Voter.js
// Central helpers for voter collections (dynamic per DB / per user)

import mongoose from 'mongoose';

const { connection, models } = mongoose;

/**
 * We keep the voter schema very loose:
 * - strict: false  => allow any fields coming from imports
 * - minimize: false => keep empty objects as-is
 * - timestamps: true => we get createdAt / updatedAt (used by sync APIs)
 */
const voterSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    minimize: false,
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

// Cache of Mongoose models per collection name
const modelCache = new Map();

/**
 * Default voter collection name when nothing else is specified.
 * You can override with env:
 *   VOTER_DB_DEFAULT_COLLECTION=my_voters
 */
export function getDefaultVoterCollection() {
  return process.env.VOTER_DB_DEFAULT_COLLECTION || 'voters';
}

/**
 * Get (or create) a Voter model for a given MongoDB collection.
 * This lets one server talk to many voter DBs just by changing collectionName.
 */
export function getVoterModel(collectionName) {
  const coll =
    (collectionName && String(collectionName).trim()) ||
    getDefaultVoterCollection();

  if (!modelCache.has(coll)) {
    const modelName = `Voter_${coll}`; // Mongoose model name (must be unique)
    const existing = models[modelName];
    if (existing) {
      modelCache.set(coll, existing);
    } else {
      modelCache.set(
        coll,
        mongoose.model(modelName, voterSchema, coll) // explicit collection
      );
    }
  }

  return modelCache.get(coll);
}

/**
 * List available voter "databases" (really: collections).
 * Returns [{ id, name }] so admin UI can show them.
 */
export async function listVoterDatabases() {
  if (!connection || !connection.db) {
    return [];
  }

  const collections = await connection.db.listCollections().toArray();

  return collections
    .filter((c) => !c.name.startsWith('system.')) // skip internal
    .map((c) => ({
      id: c.name,   // used as databaseId in frontend / admin routes
      name: c.name, // human-readable name (can be same as id)
    }));
}

/**
 * Clone one voter collection into another.
 * Used by admin to create per-user copies (u_<userKey>_<master>).
 */
export async function cloneVoterCollection(sourceName, targetName) {
  if (!connection || !connection.db) {
    throw new Error('No database connection');
  }
  if (!sourceName || !targetName) {
    throw new Error('sourceName and targetName are required');
  }

  const db = connection.db;
  const source = db.collection(sourceName);

  // Uses aggregation with $out to write into the target collection
  // (MongoDB will create / overwrite the target collection).
  await source
    .aggregate([{ $match: {} }, { $out: targetName }])
    .toArray();

  return { source: sourceName, target: targetName };
}

/**
 * Drop a voter collection completely.
 * Used when removing per-user cloned DBs from admin panel.
 */
export async function dropVoterCollection(collectionName) {
  if (!connection || !connection.db) return;
  if (!collectionName) return;

  const db = connection.db;
  try {
    await db.dropCollection(collectionName);
  } catch (err) {
    // Ignore "namespace not found" errors (collection already gone)
    if (err && err.codeName === 'NamespaceNotFound') {
      return;
    }
    throw err;
  }
}

export default {
  getDefaultVoterCollection,
  getVoterModel,
  listVoterDatabases,
  cloneVoterCollection,
  dropVoterCollection,
};
