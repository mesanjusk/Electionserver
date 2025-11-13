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

    // 👇 NEW: Cloudinary image URL for this user
    avatarUrl: {
      type: String,
      default: null,
    },

    // (optional) candidate device binding fields if you use them
    deviceIdBound: { type: String, default: null },
    deviceBoundAt: { type: Date, default: null },
    deviceHistory: {
      type: [
        {
          deviceId: String,
          action: String,
          by: String,
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// ⛔ DO NOT re-add any extra index here, `unique: true` on username is enough

export default mongoose.model('User', UserSchema);
