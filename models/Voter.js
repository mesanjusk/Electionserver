import mongoose from 'mongoose';

const VoterSchema = new mongoose.Schema(
  {
    name: { type: String, index: true },
    voter_id: String,             // remove inline index
    mobile: String,
    booth: String,
    part: String,
    serial: String,
    __raw: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Indexes
VoterSchema.index({ name: 'text' });
VoterSchema.index({ voter_id: 1 });

export default mongoose.model('Voter', VoterSchema);
