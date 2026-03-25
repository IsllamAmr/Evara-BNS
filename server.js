require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { bootstrapInitialAdmin } = require('./services/bootstrapService');
const { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } = require('./config/supabase');
const adminRoutes = require('./routes/adminRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const accountRoutes = require('./routes/accountRoutes');
const requestRoutes = require('./routes/requestRoutes');
const { attendanceRestrictionSummary } = require('./services/attendanceGuardService');
const { sanitizeRequest } = require('./middlewares/sanitizeMiddleware');
const { apiLimiter } = require('./middlewares/rateLimiters');
const { errorHandler, notFound } = require('./middlewares/errorMiddleware');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';
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
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map((item) => item.trim()) : true,
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
  req.correlationId = req.headers['x-correlation-id'] || require('crypto').randomUUID();
  res.set('x-correlation-id', req.correlationId);
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeRequest);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
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
