const PASSWORD_KEYS = new Set([
  'password',
  'current_password',
  'new_password',
  'password_confirm',
  'initial_admin_password',
]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function sanitizeMarkup(value) {
  return value
    .replace(/\0/g, '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeValue(value, key = '') {
  if (typeof value === 'string') {
    if (PASSWORD_KEYS.has(String(key).toLowerCase())) {
      return value.replace(/\0/g, '');
    }

    return sanitizeMarkup(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)])
    );
  }

  return value;
}

function sanitizeRequest(req, res, next) {
  if (req.body && isPlainObject(req.body)) {
    req.body = sanitizeValue(req.body);
  }

  if (req.query && isPlainObject(req.query)) {
    req.query = sanitizeValue(req.query);
  }

  next();
}

module.exports = {
  sanitizeRequest,
};

