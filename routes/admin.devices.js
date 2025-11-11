// routes/admin.devices.js
import { Router } from "express";
import User from "../models/User.js";
import { auth } from "../middleware/auth.js"; // your existing JWT middleware
import { requireRole } from "../middleware/roles.js";

const router = Router();

/**
 * POST /api/admin/candidates/:userId/reset-device
 */
router.post(
  "/candidates/:userId/reset-device",
  auth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "NOT_FOUND" });
      if (user.role !== "candidate")
        return res.status(400).json({ error: "NOT_CANDIDATE" });

      if (user.deviceIdBound) {
        user.deviceHistory.push({
          deviceId: user.deviceIdBound,
          action: "RESET",
          by: req.user?.email || "admin",
        });
      }
      user.deviceIdBound = null;
      user.deviceBoundAt = null;
      await user.save();

      return res.json({ ok: true });
    } catch (e) {
      console.error("RESET_DEVICE_ERROR", e);
      return res.status(500).json({ error: "SERVER_ERROR" });
    }
  }
);

export default router;
