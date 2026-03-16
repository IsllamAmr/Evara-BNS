require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const os = require('os');
const path = require('path');
const { bootstrapInitialAdmin } = require('./services/bootstrapService');
const { isSupabaseConfigured, supabaseUrl } = require('./config/supabase');
const adminRoutes = require('./routes/adminRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const { sanitizeRequest } = require('./middlewares/sanitizeMiddleware');
const { apiLimiter } = require('./middlewares/rateLimiters');
const { errorHandler, notFound } = require('./middlewares/errorMiddleware');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 0);

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
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }

  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host');
    if (host) {
      return `${protocol}://${host}`;
    }
  }

  return `http://localhost:${PORT}`;
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
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeRequest);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', apiLimiter);

app.get('/env.js', (req, res) => {
  const config = {
    API_BASE_URL: process.env.API_BASE_URL || '/api',
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    APP_URL: buildAppUrl(req),
  };

  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(`window.__EVARA_CONFIG__ = Object.assign({}, window.__EVARA_CONFIG__ || {}, ${JSON.stringify(config, null, 2)});`);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'EVARA BNS Supabase backend is running',
    supabase_configured: isSupabaseConfigured(),
    supabase_host: supabaseUrl || null,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/admin', adminRoutes);
app.use('/api/attendance', attendanceRoutes);

app.get('/checkin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkin.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
