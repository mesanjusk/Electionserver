// models/User.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true, // ✅ keep unique
      trim: true,
      lowercase: true,
    },

    passwordHash: { type: String, required: true },

    // ✅ now includes 'volunteer'
    role: {
      type: String,
      enum: ['user', 'operator', 'candidate', 'volunteer', 'admin'],
      default: 'user',
      required: true,
    },

    email: { type: String, trim: true, lowercase: true },

    // ✅ Political party fields (linked to Party master by id/code)
    partyId: {
      type: String,
      trim: true,
      default: null,
    },
    partyName: {
      type: String,
      trim: true,
      default: '',
    },

    allowedDatabaseIds: { type: [String], default: [] },

    // ✅ Avatar image URL (Cloudinary) – poster image for candidate & volunteers
    avatarUrl: {
      type: String,
      trim: true,
      default: null,
    },

    // ✅ How many volunteer logins this user is allowed to have
    maxVolunteers: {
      type: Number,
      default: 0, // 0 = no volunteers allowed
      min: 0,
    },

    // ✅ For volunteer accounts: link to parent user
    parentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    parentUsername: {
      type: String,
      trim: true,
      default: '',
    },

    // ✅ candidate / user device binding
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

    // ✅ enable / disable user & all their volunteers
    enabled: {
      type: Boolean,
      default: true, // false = cannot login
    },
  },
  { timestamps: true }
);

// ⛔ If you still have any extra unique index lines for username, remove them.
// Example (DO NOT KEEP):
// UserSchema.index({ username: 1 }, { unique: true });

export default mongoose.model('User', UserSchema);
