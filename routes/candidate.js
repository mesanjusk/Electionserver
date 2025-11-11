import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { requireRole, requireSameDevice } from '../middleware/roles.js';

const router = Router();

// Example candidate-only route
router.get(
  '/data',
  auth,                 // verifies JWT
  requireSameDevice,    // ensures same device for candidate
  requireRole('candidate'), // ensures correct role
  (req, res) => {
    res.json({
      message: 'Secure candidate data visible only from your bound device!',
      user: req.user,
      deviceIdUsed: req.deviceId,
    });
  }
);

export default router;
