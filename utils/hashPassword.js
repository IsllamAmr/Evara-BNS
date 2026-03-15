const bcrypt = require('bcrypt');

async function hashPassword(password) {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  return bcrypt.hash(password, saltRounds);
}

module.exports = hashPassword;
