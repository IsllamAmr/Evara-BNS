const crypto = require('crypto');
const express = require('express');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const pushService = require('../services/pushService');
const { protect } = require('../middlewares/authMiddleware');
const { handleValidation } = require('../middlewares/validationMiddleware');
const { sendError, sendSuccess } = require('../utils/responseHelper');

// /api/notifications: an employee turns check-out reminders on or off for this device.
const notificationRouter = express.Router();

notificationRouter.post(
  '/subscriptions',
  protect,
  [
    body('subscription.endpoint').isURL({ protocols: ['https'], require_tld: false }).withMessage('subscription.endpoint must be an https URL'),
    body('subscription.keys.p256dh').isString().isLength({ min: 10, max: 200 }),
    body('subscription.keys.auth').isString().isLength({ min: 8, max: 100 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    await pushService.saveSubscription(req.user.id, req.body.subscription, req.headers['user-agent']);
    return sendSuccess(res, { message: 'Reminders enabled on this device' }, 201);
  })
);

notificationRouter.delete(
  '/subscriptions',
  protect,
  [body('endpoint').isString().isLength({ min: 10, max: 1000 })],
  handleValidation,
  asyncHandler(async (req, res) => {
    await pushService.removeSubscription(req.user.id, req.body.endpoint);
    return sendSuccess(res, { message: 'Reminders turned off on this device' });
  })
);

// /api/cron: called by the scheduled GitHub Action with `Authorization: Bearer <CRON_SECRET>`.
const cronRouter = express.Router();

function hasCronSecret(req) {
  const expected = String(process.env.CRON_SECRET || '');
  const header = String(req.headers.authorization || '');
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (expected.length < 16 || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

cronRouter.post('/checkout-reminders', asyncHandler(async (req, res) => {
  if (!hasCronSecret(req)) {
    return sendError(res, 'Not allowed', 401);
  }
  const summary = await pushService.sendCheckoutReminders();
  return sendSuccess(res, { data: summary });
}));

module.exports = {
  cronRouter,
  notificationRouter,
};
