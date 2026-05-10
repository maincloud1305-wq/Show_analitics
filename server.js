const express = require('express');
const { Pool } = require('pg');
const path = require('path');
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

// Authentication Middleware
const auth = (req, res, next) => {
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  // Skip auth if credentials are not set in .env (for initial setup)
  if (!adminUser || !adminPass) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username === adminUser && password === adminPass) {
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    return res.status(401).send('Invalid credentials');
  }
};

// Apply auth to all routes except public assets if you want, 
// but usually it's better to protect everything.
app.use(auth);

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.use(express.static('public'));
app.use(express.json());

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

    query += ' ORDER BY created_at DESC LIMIT 100';
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

