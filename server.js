const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Database connection
// Use the public URL provided by the user as default for local, but DATABASE_URL for Railway
console.log('Starting server...');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set in environment variables!');
  process.exit(1);
}

console.log('Database connection string initialized');

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('railway.internal') || connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
});

app.use(express.json());
app.use(cookieParser('analytics-dashboard-secret')); // You can move secret to .env

// Authentication Middleware
const auth = (req, res, next) => {
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  // Skip auth if credentials are not set in .env (for initial setup)
  if (!adminUser || !adminPass) {
    return next();
  }

  // Check for auth cookie
  if (req.cookies && req.cookies.auth_token === 'authenticated') {
    return next();
  }

  // If requesting an API, return 401
  if (req.url.startsWith('/api') && req.url !== '/api/login') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // If requesting a page, redirect to login
  if (!req.url.includes('.') || req.url.endsWith('.html')) {
    if (req.url !== '/login.html') {
      return res.redirect('/login.html');
    }
  }

  next();
};

// Login API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (username === adminUser && password === adminPass) {
    res.cookie('auth_token', 'authenticated', { 
      httpOnly: true, 
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Logout API
app.get('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/login.html');
});

// Apply auth to all routes
app.use(auth);

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.use(express.static('public'));

// API: Summary Statistics
app.get('/api/stats', async (req, res) => {
  console.log('Fetching stats...');
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN has_purchased = true THEN 1 END) as purchased_users,
        COUNT(CASE WHEN has_purchased = false OR has_purchased IS NULL THEN 1 END) as non_purchased_users
      FROM users
    `);
    console.log('Stats fetched successfully');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Database error in /api/stats:', err.message);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// API: Funnel Data (by last_step)
app.get('/api/funnel', async (req, res) => {
  console.log('Fetching funnel...');
  try {
    const result = await pool.query(`
      SELECT last_step, COUNT(*) as count
      FROM users
      WHERE last_step IS NOT NULL
      GROUP BY last_step
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error in /api/funnel:', err.message);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// API: User List
app.get('/api/users', async (req, res) => {
  console.log('Fetching users...');
  try {
    const { search, filter } = req.query;
    let query = 'SELECT telegram_id, username, has_purchased, purchase_date, last_step, funnel_status, created_at FROM users';
    const params = [];

    if (search || filter) {
      query += ' WHERE ';
      if (search) {
        query += '(username ILIKE $1 OR telegram_id::text ILIKE $1)';
        params.push(`%${search}%`);
      }
      if (filter) {
        if (search) query += ' AND ';
        if (filter === 'purchased') {
          query += 'has_purchased = true';
        } else if (filter === 'not_purchased') {
          query += 'has_purchased = false';
        }
      }
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error in /api/users:', err.message);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// API: Export all users to CSV data (JSON format for frontend processing)
app.get('/api/export', async (req, res) => {
  console.log('Exporting users...');
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Database error in /api/export:', err.message);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Error handling for 404
app.use((req, res) => {
  console.warn(`404 - Not Found: ${req.url}`);
  res.status(404).send('Not Found');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

