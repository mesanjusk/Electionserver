// server/models/Party.js
import mongoose from 'mongoose';

const PartySchema = new mongoose.Schema(
  {
    uuid: { type: String },
    code: { type: String, required: true },   // e.g. "BJP"
    name: { type: String, required: true },   // e.g. "Bharatiya Janata Party"
    type: { type: String },                   // NATIONAL / STATE etc.
    logoUrl: { type: String },                // if you later store logo URLs
  },
  {
    timestamps: true,
    collection: 'Party', // 👈 IMPORTANT: matches your existing collection name
  }
);

export default mongoose.model('Party', PartySchema);
