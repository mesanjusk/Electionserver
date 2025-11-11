import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,        // ✅ only username is unique
      trim: true,
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['user', 'operator', 'candidate', 'admin'],
      default: 'user',
      required: true,
    },
    // email is optional and NOT unique
    email: {
      type: String,
      required: false,
      index: false,
      unique: false,
      sparse: false,
      trim: true,
      lowercase: true,
    },
    allowedDatabaseIds: {
      type: [String],      // e.g. ["Gondia 01","Gondia 02"]
      default: [],
    },
  },
  { timestamps: true }
);

// Safety: ensure there is an index on username unique
UserSchema.index({ username: 1 }, { unique: true });

export default mongoose.model('User', UserSchema);
