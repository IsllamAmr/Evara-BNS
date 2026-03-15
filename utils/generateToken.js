const jwt = require('jsonwebtoken');

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      employee_id: user.employee_id,
      role: user.role,
      email: user.email,
      full_name: user.full_name,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    }
  );
}

module.exports = generateToken;
