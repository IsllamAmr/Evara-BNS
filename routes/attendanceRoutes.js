const express = require('express');
const { checkIn, checkOut, getQrCode } = require('../controllers/attendanceController');
const { protect } = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/roleMiddleware');

const router = express.Router();

router.post('/checkin', protect, checkIn);
router.post('/checkout', protect, checkOut);
router.get('/qr', protect, requireAdmin, getQrCode);

module.exports = router;

