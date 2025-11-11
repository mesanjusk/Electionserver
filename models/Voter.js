// server/models/Voter.js
import mongoose from 'mongoose';

// ------------------------------- schema ------------------------------- //
const BaseVoterSchema = new mongoose.Schema(
  {
    name: { type: String, index: true },
    voter_id: String, // avoid duplicate index warning by removing inline index
    mobile: String,
    booth: String,
    part: String,
    serial: String,
    __raw: { type: mongoose.Schema.Types.Mixed },
  },
  {
    timestamps: true,
  }
);

BaseVoterSchema.index({ name: 'text' });
BaseVoterSchema.index({ voter_id: 1 });

// ----------------------------- configuration ----------------------------- //
const DEFAULT_COLLECTION =
  process.env.VOTER_COLLECTION ||
  process.env.DEFAULT_VOTER_COLLECTION ||
  'voters';

function getTargetDbName(connection = mongoose.connection) {
  const fallbackDbName = connection?.name || 'voter_search';
  return (
    process.env.VOTER_SEARCH_DB ||
    process.env.MONGO_VOTER_DB ||
    process.env.MONGO_DB ||
    fallbackDbName
  );
}

// Cache models per collection to avoid recompilation on repeated access.
const modelCache = new Map();

function makeModelName(collectionName) {
  const safe = String(collectionName)
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Default';
  return `Voter_${safe}`;
}

export function getDefaultVoterCollection() {
  return DEFAULT_COLLECTION;
}

export function getVoterModel(collectionName) {
  const requested = String(collectionName || '').trim();
  if (!requested) {
    throw new Error('Collection name is required for voter model');
  }

  const connection = mongoose.connection;
  if (!connection?.readyState) {
    throw new Error('MongoDB connection is not ready');
  }

  const dbName = getTargetDbName(connection);
  const cacheKey = `${dbName}::${requested}`;
  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey);
  }

  const db = connection.useDb(dbName, { useCache: true });
  const modelName = makeModelName(requested);

  // clone schema per model to avoid collection mix-ups
  const schema = BaseVoterSchema.clone();
  const model = db.models[modelName] || db.model(modelName, schema, requested);

  modelCache.set(cacheKey, model);
  return model;
}

export async function listVoterDatabases() {
  const connection = mongoose.connection;
  if (!connection) return [];

  const client = typeof connection.getClient === 'function'
    ? connection.getClient()
    : connection.client;

  if (!client) return [];

  const dbName = getTargetDbName(connection);
  const db = client.db(dbName);
  const collections = await db.listCollections().toArray();

  return collections
    .filter(col => !col.name.startsWith('system.'))
    .map(col => {
      const pretty = String(col.name)
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

      return {
        id: col.name,
        _id: col.name,
        name: pretty || col.name,
        label: pretty || col.name,
        collection: col.name,
        type: col.type || 'collection',
      };
    });
}

// Maintain backward compatibility for legacy imports that expect a default export.
const defaultSchema = BaseVoterSchema.clone();
export default mongoose.models.LegacyVoter ||
  mongoose.model('LegacyVoter', defaultSchema, DEFAULT_COLLECTION);

export { BaseVoterSchema as VoterSchema };
