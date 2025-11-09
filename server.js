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

const app = express();

// ---- CORS (before anything else that handles requests) ----
const defaultAllowedOrigins = [
  'https://election-front-beta.vercel.app',
  'http://localhost:5173',
  'https://vote.sanjusk.in',
];

const allowedOrigins = Array.from(new Set([
  ...defaultAllowedOrigins,
  ...(process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
]));

// If you only need your Vercel site + local dev, set this env exactly:
// CORS_ORIGIN=https://election-front-beta.vercel.app,http://localhost:5173

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow curl/postman
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true, // set false if you don’t use cookies
}));

// Make sure we answer OPTIONS everywhere
app.options('*', cors());

// ---- General middleware ----
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// ---- Health ----
app.get('/', (req, res) => res.json({ ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Routes ----
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/voters', voterRoutes);

const PORT = process.env.PORT || 4000;

async function ensureDefaultAdmin() {
  const count = await User.countDocuments();
  if (count > 0) return;
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'password123';
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ email, passwordHash, role: 'admin' });
  console.log(`Auto-created admin → ${email} / ${password}`);
}

connectDB(process.env.MONGO_URI)
  .then(async () => {
    await ensureDefaultAdmin();
    app.listen(PORT, () => console.log(`API listening on :${PORT}`));
  })
  .catch((e) => { console.error('DB Error', e); process.exit(1); });
