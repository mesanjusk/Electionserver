// server/models/User.js
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
    // We’ll primarily use username (email optional).
    username: { type: String, trim: true, unique: true, sparse: true, index: true },
    email: { type: String, trim: true, unique: true, sparse: true, index: true },

    passwordHash: { type: String, required: true },

    // Admin can grant roles: admin / operator / candidate / user
    role: {
      type: String,
      enum: ['admin', 'operator', 'candidate', 'user'],
      default: 'user',
      index: true,
    },

    // Which voter DBs this user can access
    allowedDatabaseIds: { type: [String], default: [] },

    // Single-device binding (used for candidates)
    deviceIdBound: { type: String, default: null, index: true },
    deviceBoundAt: { type: Date, default: null },
    deviceHistory: { type: [DeviceHistorySchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
