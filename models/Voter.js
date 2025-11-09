import mongoose from 'mongoose';

const voterSchema = new mongoose.Schema({
  __raw: { type: Object, default: {} },
  name: { type: String, index: true },
  voter_id: { type: String, index: true }
}, { strict: false, timestamps: true });

voterSchema.index({ name: 'text' });

export default mongoose.model('Voter', voterSchema);
