// server/index.js (or server.js)
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
import candidateRoutes from './routes/candidate.js';

dotenv.config();

const app = express();

/* ---------------------- Device ID extractor (global) --------------------- */
/** Reads device ID from header or body and puts it on req.deviceId */
function attachDeviceId(req, _res, next) {
  const headerId =
    req.get('X-Device-Id') ||
    req.get('x-device-id') ||
    req.get('X-DEVICE-ID');
  req.deviceId = headerId || req.body?.deviceId || null;
  next();
}

/* -------------------------------- CORS -------------------------------- */
const defaultAllowedOrigins = [
  'https://election-front-beta.vercel.app',
  'http://localhost:5173',
  'https://vote.sanjusk.in',
];

// Parse comma-separated env list (e.g., CORS_ORIGIN="https://foo.app,https://bar.site")
const extraAllowed = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...extraAllowed]));

/** Decide if origin is allowed */
function isOriginAllowed(origin) {
  if (!origin) return true; // allow curl/postman/native fetch
  return allowedOrigins.includes(origin);
}

// Fast-path OPTIONS with custom headers allowed (incl. X-Device-Id)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || '';
    if (isOriginAllowed(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        // ✨ Added X-Device-Id
        'Content-Type, Authorization, X-Device-Id'
      );
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.status(204).end();
    }
    return res.status(403).json({ error: 'Not allowed by CORS (preflight)' });
  }
  next();
});

app.use(
  cors({
    origin: (origin, cb) => {
      if (isOriginAllowed(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // ✨ Allow custom device header in actual requests too
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    credentials: true,
  })
);

/* ----------------------------- General middleware ----------------------------- */
app.use(express.json({ limit: '1mb' }));
app.use(attachDeviceId); // ✨ make req.deviceId available to all routes
app.use(morgan('dev'));

// Handle invalid JSON body cleanly
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  return next(err);
});

/* --------------------------------- Health --------------------------------- */
app.get('/', (req, res) => res.json({ ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

/* --------------------------------- Routes --------------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/voters', voterRoutes);
app.use('/api/candidate', candidateRoutes);

// Optional: redirect SPA-only deep links back to root (backend hosts API only)
['/login'].forEach(route => {
  app.get(route, (req, res) => res.redirect(302, '/'));
});

// Avoid noisy favicon lookups
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 404 for unknown API paths
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* --------------------------- Error handler (last) --------------------------- */
app.use((err, req, res, _next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Not allowed by CORS' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 4000;

/* -------------------------- Bootstrap default admin ------------------------- */
async function ensureDefaultAdmin() {
  const count = await User.countDocuments();
  if (count > 0) return;
  const email = process.env.DEFAULT_ADMIN_EMAIL || null;
  const username =
    process.env.DEFAULT_ADMIN_USERNAME ||
    (email ? email.split('@')[0] : 'admin');
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'password123';
  const passwordHash = await bcrypt.hash(password, 10);
  const payload = {
    username,
    passwordHash,
    role: 'admin',
  };
  if (email) payload.email = email;
  await User.create(payload);
  if (email) {
    console.log(`Auto-created admin → ${username} (${email}) / ${password}`);
  } else {
    console.log(`Auto-created admin → ${username} / ${password}`);
  }
}

/* --------------------------------- Startup --------------------------------- */
if (!process.env.MONGO_URI) {
  console.error('Missing MONGO_URI in environment');
  process.exit(1);
}

connectDB(process.env.MONGO_URI)
  .then(async () => {
    await ensureDefaultAdmin();
    const server = app.listen(PORT, () => console.log(`API listening on :${PORT}`));

    // Graceful shutdown
    const shutdown = (sig) => () => {
      console.log(`\n${sig} received. Shutting down...`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGINT', shutdown('SIGINT'));
    process.on('SIGTERM', shutdown('SIGTERM'));
  })
  .catch((e) => {
    console.error('DB Error', e);
    process.exit(1);
  });
