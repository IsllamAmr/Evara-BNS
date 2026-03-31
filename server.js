require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { bootstrapInitialAdmin } = require('./services/bootstrapService');
const {
  isSupabaseConfigured,
  missingSupabaseEnvKeys,
  supabaseAnonKey,
  supabaseUrl,
} = require('./config/supabase');
const adminRoutes = require('./routes/adminRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const accountRoutes = require('./routes/accountRoutes');
const requestRoutes = require('./routes/requestRoutes');
const { attendanceRestrictionSummary } = require('./services/attendanceGuardService');
const { sanitizeRequest } = require('./middlewares/sanitizeMiddleware');
const { apiLimiter, rateLimitBackend } = require('./middlewares/rateLimiters');
const { errorHandler, notFound } = require('./middlewares/errorMiddleware');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = (process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const REQUEST_LOG_FORMAT = String(process.env.REQUEST_LOG_FORMAT || '').trim().toLowerCase();
const USE_JSON_REQUEST_LOGS = REQUEST_LOG_FORMAT === 'json';
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 0);
const publicDirectory = path.join(__dirname, 'public');
const HTML_TEMPLATES = {
  index: fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8'),
  checkin: fs.readFileSync(path.join(publicDirectory, 'checkin.html'), 'utf8'),
};
const PAGE_METADATA = {
  index: {
    title: 'EVARA BNS | Attendance System',
    description: 'Track attendance, employee operations, and daily work status from one secure EVARA BNS dashboard.',
  },
  checkin: {
    title: 'EVARA BNS | Check In',
    description: 'Open the EVARA BNS check-in page to record attendance and manage your workday quickly.',
  },
};
const SOCIAL_IMAGE_SOURCE = path.join(publicDirectory, 'assets', 'evara_bns_background_1773549442878.png');
const SOCIAL_IMAGE_PATH = '/social-preview.png';
const SOCIAL_IMAGE_ALT = 'EVARA BNS attendance dashboard preview';

function resolveRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    return String(forwardedFor).split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
}

function attachRequestLogger(appInstance) {
  if (USE_JSON_REQUEST_LOGS) {
    appInstance.use((req, res, next) => {
      const startedAtNs = process.hrtime.bigint();

      res.on('finish', () => {
        const elapsedNs = process.hrtime.bigint() - startedAtNs;
        const durationMs = Number(elapsedNs) / 1e6;
        const entry = {
          timestamp: new Date().toISOString(),
          level: 'info',
          event: 'http_request',
          correlation_id: req.correlationId || null,
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          duration_ms: Number(durationMs.toFixed(2)),
          ip: resolveRequestIp(req),
          user_agent: req.headers['user-agent'] || null,
        };

        process.stdout.write(`${JSON.stringify(entry)}\n`);
      });

      next();
    });

    return;
  }

  morgan.token('correlation-id', (req) => req.correlationId || '-');
  appInstance.use(morgan(IS_PRODUCTION
    ? ':remote-addr :method :url :status :res[content-length] - :response-time ms cid=:correlation-id'
    : 'dev'));
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toOrigin(value) {
  try {
    return new URL(String(value || '').trim()).origin;
  } catch (_error) {
    return '';
  }
}

function resolveAllowedOrigins() {
  const configuredOrigins = [
    ...parseCsv(process.env.FRONTEND_URL),
    (process.env.APP_URL || '').trim(),
  ]
    .map((value) => toOrigin(value))
    .filter(Boolean);

  if (!IS_PRODUCTION) {
    configuredOrigins.push(
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      'http://localhost:8081',
      'http://127.0.0.1:8081'
    );
  }

  return new Set(configuredOrigins);
}

const ALLOWED_ORIGINS = resolveAllowedOrigins();

function validateRuntimeConfig() {
  const errors = [];
  const frontEndRawOrigins = parseCsv(process.env.FRONTEND_URL);
  const frontEndNormalizedOrigins = frontEndRawOrigins.map((value) => toOrigin(value)).filter(Boolean);

  if (IS_PRODUCTION) {
    const missingSupabase = missingSupabaseEnvKeys();
    if (missingSupabase.length) {
      errors.push(`Missing required Supabase environment variables: ${missingSupabase.join(', ')}`);
    }

    if (!frontEndRawOrigins.length) {
      errors.push('FRONTEND_URL is required in production and must contain at least one allowed origin');
    }
    if (frontEndRawOrigins.length !== frontEndNormalizedOrigins.length) {
      errors.push('FRONTEND_URL contains invalid URL values. Use absolute origins such as https://app.example.com');
    }
  } else {
    const missingSupabase = missingSupabaseEnvKeys();
    if (missingSupabase.length) {
      console.warn(
        `Warning: Supabase is not fully configured in development (${missingSupabase.join(', ')}).`
      );
    }
  }

  if (errors.length) {
    throw new Error(`Runtime configuration validation failed:\n- ${errors.join('\n- ')}`);
  }
}

validateRuntimeConfig();

function getLanAddress() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }

  return 'localhost';
}

function buildAppUrl(req) {
  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) {
      return `${protocol}://${host}`;
    }
  }

  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }

  return `http://localhost:${PORT}`;
}

function buildAbsoluteUrl(req, pathname = '/') {
  return new URL(pathname, `${buildAppUrl(req)}/`).toString();
}

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderHtmlTemplate(templateName, req) {
  const template = HTML_TEMPLATES[templateName];
  const metadata = PAGE_METADATA[templateName];
  const pageUrl = buildAbsoluteUrl(req, req.originalUrl || '/');
  const replacements = {
    '%PAGE_TITLE%': metadata.title,
    '%PAGE_DESCRIPTION%': metadata.description,
    '%PAGE_URL%': pageUrl,
    '%OG_IMAGE_URL%': buildAbsoluteUrl(req, SOCIAL_IMAGE_PATH),
    '%OG_IMAGE_ALT%': SOCIAL_IMAGE_ALT,
  };

  return Object.entries(replacements).reduce((html, [token, value]) => (
    html.replaceAll(token, escapeHtmlAttribute(value))
  ), template);
}

function sendRenderedHtml(res, templateName, req) {
  res.type('html');
  res.send(renderHtmlTemplate(templateName, req));
}

function buildContentSecurityPolicy() {
  let supabaseOrigin = null;

  try {
    supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : null;
  } catch (_error) {
    supabaseOrigin = null;
  }

  const connectSources = ["'self'"];
  if (supabaseOrigin) {
    connectSources.push(supabaseOrigin);
    connectSources.push(supabaseOrigin.replace(/^http/, 'ws'));
  }

  return {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: connectSources,
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  };
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (ALLOWED_ORIGINS.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.disable('x-powered-by');
app.set('trust proxy', Number.isFinite(TRUST_PROXY_HOPS) ? TRUST_PROXY_HOPS : 0);
app.use(
  helmet({
    contentSecurityPolicy: buildContentSecurityPolicy(),
    crossOriginEmbedderPolicy: false,
  })
);

// Add correlation ID to all requests
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.set('x-correlation-id', req.correlationId);
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeRequest);
attachRequestLogger(app);
app.use('/api', apiLimiter);

app.get('/env.js', (req, res) => {
  const config = {
    API_BASE_URL: process.env.API_BASE_URL || '/api',
    SUPABASE_URL: supabaseUrl || '',
    SUPABASE_ANON_KEY: supabaseAnonKey || '',
    APP_URL: buildAppUrl(req),
  };

  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(`window.__EVARA_CONFIG__ = Object.assign({}, window.__EVARA_CONFIG__ || {}, ${JSON.stringify(config, null, 2)});`);
});

app.get('/', (req, res) => {
  sendRenderedHtml(res, 'index', req);
});

app.get('/index.html', (req, res) => {
  sendRenderedHtml(res, 'index', req);
});

app.get('/checkin', (req, res) => {
  sendRenderedHtml(res, 'checkin', req);
});

app.get('/checkin.html', (req, res) => {
  sendRenderedHtml(res, 'checkin', req);
});

app.get(SOCIAL_IMAGE_PATH, (req, res) => {
  res.sendFile(SOCIAL_IMAGE_SOURCE);
});

app.use(express.static(publicDirectory, { index: false }));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'EVARA BNS Supabase backend is running',
    supabase_configured: isSupabaseConfigured(),
    supabase_host: supabaseUrl || null,
    rate_limit_backend: rateLimitBackend(),
    attendance_restrictions: attendanceRestrictionSummary(),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/admin', adminRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/requests', requestRoutes);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  return sendRenderedHtml(res, 'index', req);
});

app.use(notFound);
app.use(errorHandler);

function runBootstrapInBackground() {
  if (!isSupabaseConfigured()) {
    return;
  }

  bootstrapInitialAdmin()
    .then((bootstrapResult) => {
      if (bootstrapResult?.created) {
        console.log(`Initial admin created for ${bootstrapResult.email}`);
      }
    })
    .catch((error) => {
      console.error('Initial admin bootstrap failed:', error.message);
    });
}

async function startServer() {
  app.listen(PORT, HOST, () => {
    const lanAddress = getLanAddress();
    console.log(`EVARA BNS running at http://localhost:${PORT}`);
    console.log(`EVARA BNS LAN URL: http://${lanAddress}:${PORT}`);
    runBootstrapInBackground();
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
