import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDB } from '../db.js';
import User from '../models/User.js';
import Voter from '../models/Voter.js';

dotenv.config();

function resolveSeedPath() {
  // Prefer env path; default to ./data/voters.sample.json (relative to server/)
  const envPath = process.env.SEED_JSON_PATH;
  const defaultRel = './data/voters.sample.json';
  const candidates = [
    envPath,
    defaultRel,
  ].filter(Boolean);

  for (const p of candidates) {
    const abs = path.resolve(process.cwd(), p);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

const seed = async () => {
  await connectDB(process.env.MONGO_URI);

  // Ensure at least one admin exists (same as server startup logic)
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'password123';
  const existing = await User.findOne({ email });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ email, passwordHash, role: 'admin' });
    console.log(`Seeded user → ${email} / ${password}`);
  } else {
    console.log(`User already exists → ${email}`);
  }

  const seedPath = resolveSeedPath();
  if (!seedPath) {
    console.error('Missing voters JSON. Expected at server/data/voters.sample.json or set SEED_JSON_PATH.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  const nameKeys = ['name', 'Name', 'Full Name', 'FULL NAME', 'नाम', 'Voter Name'];
  const voterIdKeys = ['voter_id', 'Voter Id', 'VoterID', 'EPIC', 'EPIC_NO', 'EPIC NO'];

  const docs = raw.map(r => {
    const nameKey = nameKeys.find(k => Object.hasOwn(r, k));
    const voterIdKey = voterIdKeys.find(k => Object.hasOwn(r, k));
    return {
      ...r,
      __raw: r,
      name: nameKey ? String(r[nameKey]) : undefined,
      voter_id: voterIdKey ? String(r[voterIdKey]) : undefined,
    };
  });

  await Voter.deleteMany({});
  await Voter.insertMany(docs);
  console.log(`Seeded voters → ${docs.length}`);

  process.exit(0);
};

seed().catch(e => { console.error(e); process.exit(1); });
