import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB } from './db.js';
import authRoutes from './routes/auth.js';
import voterRoutes from './routes/voters.js';
import adminRoutes from './routes/admin.js';
import User from './models/User.js';
import bcrypt from 'bcryptjs';

dotenv.config();

async function ensureDefaultAdmin() {
  const count = await User.countDocuments();
  if (count > 0) return;
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'password123';
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ email, passwordHash, role: 'admin' });
  console.log(`Auto-created admin → ${email} / ${password}`);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));

app.get('/', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/voters', voterRoutes);

const PORT = process.env.PORT || 4000;
connectDB(process.env.MONGO_URI)
  .then(async () => {
    await ensureDefaultAdmin();
    app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
  })
  .catch((e) => { console.error('DB Error', e); process.exit(1); });
