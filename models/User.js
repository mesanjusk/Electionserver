// models/User.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,     // ✅ keep this
      trim: true,
      lowercase: true,
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['user', 'operator', 'candidate', 'admin'],
      default: 'user',
      required: true,
    },
    email: { type: String, trim: true, lowercase: true },
    allowedDatabaseIds: { type: [String], default: [] },

    // (optional) candidate device binding fields if you use them
    deviceIdBound: { type: String, default: null },
    deviceBoundAt: { type: Date, default: null },
    deviceHistory: {
      type: [{ deviceId: String, action: String, by: String, at: { type: Date, default: Date.now } }],
      default: [],
    },
  },
  { timestamps: true }
);

// ⛔ REMOVE this line if it exists:
// UserSchema.index({ username: 1 }, { unique: true });

export default mongoose.model('User', UserSchema);
