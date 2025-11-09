// server/routes/admin.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();

// POST /api/admin/users   { email, password, role: 'operator'|'admin' }
router.post('/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const { email, password, role = 'operator' } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email & password required' });
    if (!['admin', 'operator', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash, role });
    res.json({ ok: true, user: { id: user._id, email: user.email, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
