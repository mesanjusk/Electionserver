// models/User.js
import mongoose from 'mongoose';

// Optional: small audit trail for device binding
const DeviceHistorySchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    action: { type: String, enum: ['BOUND', 'RESET'], required: true },
    by: { type: String }, // 'system' or admin identifier/email
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },

    // If you treat "user" as candidate, you can leave enum as ['admin','user'].
    // Added 'candidate' and 'operator' for clarity/forward-compat.
    role: {
      type: String,
      enum: ['admin', 'operator', 'candidate', 'user'],
      default: 'user',
      index: true,
    },

    // --- Single-device binding (used for candidates) ---
    deviceIdBound: { type: String, default: null, index: true },
    deviceBoundAt: { type: Date, default: null },
    deviceHistory: { type: [DeviceHistorySchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
