const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8080;
const SCHEMES_FILE = path.join(__dirname, 'schemes.json');
const CENTRES_FILE = path.join(__dirname, 'centres.json');
const DB_FILE = path.join(__dirname, 'schemes.db');

// Initialize SQLite Database
const db = new DatabaseSync(DB_FILE);

// Setup Database Schema & Seed Data
function initDatabase() {
  console.log('Initializing SQLite database:', DB_FILE);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS government_schemes (
      id TEXT PRIMARY KEY,
      scheme_name TEXT NOT NULL,
      scheme_code TEXT,
      government_level TEXT,
      state TEXT,
      ministry TEXT,
      department TEXT,
      category TEXT,
      sub_category TEXT,
      short_description TEXT,
      detailed_description TEXT,
      benefits TEXT,
      eligibility_rules TEXT,
      full_eligibility TEXT,
      required_documents TEXT,
      application_process TEXT,
      application_url TEXT,
      official_source_url TEXT,
      helpline_number TEXT,
      start_date TEXT,
      end_date TEXT,
      renewal_required INTEGER,
      renewal_period TEXT,
      active_status TEXT DEFAULT 'ACTIVE',
      last_verified_at TEXT,
      source_type TEXT,
      stats TEXT
    )
  `);

  try {
    db.exec('ALTER TABLE government_schemes ADD COLUMN full_eligibility TEXT');
  } catch (e) {
    // Ignore if the column already exists.
  }

  // Seed from schemes.json if table is empty
  const countRow = db.prepare('SELECT COUNT(*) as count FROM government_schemes').get();
  if (countRow.count === 0 && fs.existsSync(SCHEMES_FILE)) {
    console.log('Seeding SQLite database from schemes.json...');
    const seedData = JSON.parse(fs.readFileSync(SCHEMES_FILE, 'utf8'));
    seedSchemesToDB(seedData);
  }
}

function seedSchemesToDB(schemesList) {
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO government_schemes (
      id, scheme_name, scheme_code, government_level, state, ministry, department,
      category, sub_category, short_description, detailed_description, benefits,
      eligibility_rules, full_eligibility, required_documents, application_process,
      application_url, official_source_url, helpline_number, start_date, end_date,
      renewal_required, renewal_period, active_status, last_verified_at, source_type, stats
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  for (const s of schemesList) {
    insertStmt.run(
      s.id,
      typeof s.scheme_name === 'object' ? JSON.stringify(s.scheme_name) : s.scheme_name,
      s.scheme_code || '',
      s.government_level || 'Central',
      s.state || 'All States',
      s.ministry || '',
      s.department || '',
      s.category || 'Social Welfare',
      s.sub_category || '',
      typeof s.short_description === 'object' ? JSON.stringify(s.short_description) : s.short_description,
      typeof s.detailed_description === 'object' ? JSON.stringify(s.detailed_description) : s.detailed_description,
      typeof s.benefits === 'object' ? JSON.stringify(s.benefits) : s.benefits,
      typeof s.eligibility_rules === 'object' ? JSON.stringify(s.eligibility_rules) : s.eligibility_rules,
      typeof s.full_eligibility === 'object' ? JSON.stringify(s.full_eligibility) : JSON.stringify({
        eligibilityVerified: false,
        source: { title: 'Official scheme page', url: s.official_source_url || '' },
        criteria: []
      }),
      typeof s.required_documents === 'object' ? JSON.stringify(s.required_documents) : s.required_documents,
      typeof s.application_process === 'object' ? JSON.stringify(s.application_process) : s.application_process,
      s.application_url || '',
      s.official_source_url || '',
      s.helpline_number || '',
      s.start_date || '',
      s.end_date || null,
      s.renewal_required ? 1 : 0,
      s.renewal_period || null,
      s.active_status || 'ACTIVE',
      s.last_verified_at || new Date().toLocaleDateString('en-GB'),
      s.source_type || 'Official Government Source',
      typeof (s.statistics || s.stats) === 'object' ? JSON.stringify(s.statistics || s.stats) : JSON.stringify({ views: 100, applications: 50, approved: 45, isDemo: true })
    );
  }
}

// Convert SQLite row back to clean JSON object for API response
function formatSchemeRow(row) {
  if (!row) return null;
  return {
    ...row,
    scheme_name: safeParseJSON(row.scheme_name, { ta: row.scheme_name, en: row.scheme_name }),
    short_description: safeParseJSON(row.short_description, { ta: row.short_description, en: row.short_description }),
    detailed_description: safeParseJSON(row.detailed_description, { ta: row.detailed_description, en: row.detailed_description }),
    benefits: safeParseJSON(row.benefits, { ta: row.benefits, en: row.benefits }),
    eligibility_rules: safeParseJSON(row.eligibility_rules, {}),
    full_eligibility: safeParseJSON(row.full_eligibility, {
      eligibilityVerified: false,
      source: { title: 'Official scheme page', url: row.official_source_url || '' },
      criteria: []
    }),
    required_documents: safeParseJSON(row.required_documents, []),
    application_process: safeParseJSON(row.application_process, { ta: '', en: '' }),
    renewal_required: Boolean(row.renewal_required),
    statistics: normalizeStatistics(safeParseJSON(row.stats, { views: 100, applications: 50, approved: 45, isDemo: true }))
  };
}

function normalizeStatistics(statistics) {
  return {
    views: Number(statistics.views ?? statistics.viewed ?? 0),
    applications: Number(statistics.applications ?? statistics.applied ?? 0),
    approved: Number(statistics.approved ?? 0),
    isDemo: statistics.isDemo !== false
  };
}

function safeParseJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function normalizeValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (value === true || ['yes', 'true', '1'].includes(normalized)) return 'yes';
  if (value === false || ['no', 'false', '0'].includes(normalized)) return 'no';
  return normalized;
}

function parseProfileNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getEducationRank(value) {
  const education = normalizeValue(value);
  const ranks = {
    school_below: 0,
    'up to 8th standard': 0,
    sslc: 1,
    '10th': 1,
    '10th standard': 1,
    '10th pass': 1,
    hsc: 2,
    '12th': 2,
    '12th standard': 2,
    diploma: 3,
    degree: 4,
    ug: 4,
    undergraduate: 4,
    'undergraduate / college': 4,
    pg: 5,
    postgraduate: 5,
    'post graduate': 5
  };
  return Object.prototype.hasOwnProperty.call(ranks, education) ? ranks[education] : null;
}

function valuesMatch(value, allowedValues) {
  const normalizedValue = normalizeValue(value);
  const allowed = Array.isArray(allowedValues) ? allowedValues : [allowedValues];
  return allowed.some(item => normalizeValue(item) === normalizedValue);
}

function isEligible(user, scheme) {
  const rules = scheme.eligibility_rules || {};
  const missingFields = new Set();
  let eligible = true;

  const checkValue = (field, rule, label) => {
    if (rule === undefined || rule === null) return;
    if (user[field] === undefined || user[field] === null || String(user[field]).trim() === '') {
      missingFields.add(label);
    } else if (!valuesMatch(user[field], rule)) {
      eligible = false;
    }
  };

  const age = parseProfileNumber(user.age);
  if (rules.minAge !== undefined || rules.maxAge !== undefined) {
    if (age === null) {
      missingFields.add('Age');
    } else if ((rules.minAge !== undefined && age < Number(rules.minAge)) ||
               (rules.maxAge !== undefined && age > Number(rules.maxAge))) {
      eligible = false;
    }
  }

  const income = parseProfileNumber(user.income);
  if (rules.incomeMax !== undefined) {
    if (income === null) {
      missingFields.add('Annual Family Income');
    } else if (income > Number(rules.incomeMax)) {
      eligible = false;
    }
  }

  checkValue('gender', rules.gender, 'Gender');
  checkValue('occupation', rules.occupation, 'Occupation');
  checkValue('disability', rules.disability, 'Disability Status');
  checkValue('caste', rules.caste, 'Community Category');
  checkValue('marital', rules.marital, 'Marital Status');
  checkValue('landOwner', rules.landOwner, 'Land Ownership');
  checkValue('ownPuccaHouse', rules.ownPuccaHouse, 'Pucca House Ownership');
  checkValue('schoolType', rules.schoolType, 'School Type');

  if (rules.educationMin !== undefined) {
    const educationRank = getEducationRank(user.education);
    const minimumRank = getEducationRank(rules.educationMin);
    if (educationRank === null) {
      missingFields.add('Education Level');
    } else if (minimumRank !== null && educationRank < minimumRank) {
      eligible = false;
    }
  }

  const requiredState = rules.residence || rules.states ||
    (scheme.state && normalizeValue(scheme.state) !== 'all states' ? scheme.state : undefined);
  if (requiredState !== undefined) {
    const state = normalizeValue(user.state);
    if (!state || state === 'all states') {
      missingFields.add('State');
    } else if (!valuesMatch(state, requiredState)) {
      eligible = false;
    }
  }

  return { eligible: eligible && missingFields.size === 0, missingFields: eligible ? [...missingFields] : [] };
}

// Helper: Read JSON file safely
function loadData(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
    return [];
  }
}

// Helper: Save JSON file safely
function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing to ${file}:`, err);
    return false;
  }
}

// Initialize SQLite Database
initDatabase();

// Server Creation
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API ENDPOINTS ---

  // 1. GET /api/schemes
  if (pathname === '/api/schemes' && method === 'GET') {
    const { search, category, level, state, status } = parsedUrl.query;
    let query = 'SELECT * FROM government_schemes WHERE 1=1';
    const params = [];

    // Default: Show ACTIVE schemes
    const targetStatus = status || 'ACTIVE';
    if (targetStatus !== 'ALL') {
      query += ' AND active_status = ?';
      params.push(targetStatus);
    }

    if (category && category !== 'all') {
      query += ' AND LOWER(category) = LOWER(?)';
      params.push(category);
    }

    if (level && level !== 'all') {
      query += ' AND LOWER(government_level) = LOWER(?)';
      params.push(level);
    }

    if (state && state !== 'all') {
      query += ' AND (state = "All States" OR LOWER(state) = LOWER(?))';
      params.push(state);
    }

    if (search) {
      query += ' AND (LOWER(scheme_name) LIKE ? OR LOWER(short_description) LIKE ? OR LOWER(category) LIKE ? OR LOWER(department) LIKE ?)';
      const term = `%${search.toLowerCase()}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY id ASC';

    try {
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      const formatted = rows.map(formatSchemeRow);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: formatted.length, data: formatted }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 2. GET /api/schemes/:id
  if (pathname.startsWith('/api/schemes/') && method === 'GET') {
    const id = pathname.replace('/api/schemes/', '');
    try {
      const row = db.prepare('SELECT * FROM government_schemes WHERE id = ?').get(id);
      if (row) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: formatSchemeRow(row) }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Scheme not found' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 3. POST /api/dynamic-fields (AI Rule Analyzer for Dynamic Form Fields)
  if (pathname === '/api/dynamic-fields' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const occupation = payload.occupation || 'student';
        const age = parseInt(payload.age) || 20;

        // Fetch candidate active schemes
        const rows = db.prepare("SELECT eligibility_rules FROM government_schemes WHERE active_status = 'ACTIVE'").all();
        const requiredFieldsSet = new Set(['gender', 'income']);

        rows.forEach(r => {
          const rules = safeParseJSON(r.eligibility_rules, {});
          if (rules.educationMin) requiredFieldsSet.add('education');
          if (rules.caste) requiredFieldsSet.add('caste');
          if (rules.disability) requiredFieldsSet.add('disability');
          if (rules.marital) requiredFieldsSet.add('marital');
          if (rules.landOwner !== undefined) requiredFieldsSet.add('landOwner');
          if (rules.ownPuccaHouse !== undefined) requiredFieldsSet.add('ownPuccaHouse');
          if (rules.schoolType !== undefined) requiredFieldsSet.add('schoolType');
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          step: 2,
          occupation: occupation,
          requiredFields: Array.from(requiredFieldsSet)
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // 4. POST /api/schemes/match (Deterministic Eligibility Matching Engine)
  if (pathname === '/api/schemes/match' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const profile = JSON.parse(body || '{}');
        const rows = db.prepare("SELECT * FROM government_schemes WHERE active_status = 'ACTIVE'").all();
        const schemes = rows.map(formatSchemeRow);
        const results = [];
        const incomplete = [];

        schemes.forEach(scheme => {
          const match = isEligible(profile, scheme);
          if (match.eligible) {
            results.push({
              scheme,
              matchType: 'eligible',
              relevanceScore: 100,
              reason: {
                ta: 'உங்கள் விவரங்கள் திட்டத்தில் குறிப்பிடப்பட்ட தகுதிகளுடன் பொருந்துகின்றன.',
                en: 'Your details match the eligibility conditions specified for this scheme.'
              },
              disclaimer: 'Final eligibility and approval are determined by the concerned government department.'
            });
          } else if (match.missingFields.length > 0) {
            incomplete.push({ schemeId: scheme.id, missingFields: match.missingFields });
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: results.length, data: results, incomplete }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // 5. POST /api/schemes/explain (AI Scheme Explanation Generator)
  if (pathname === '/api/schemes/explain' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { schemeId, lang } = JSON.parse(body || '{}');
        const row = db.prepare('SELECT * FROM government_schemes WHERE id = ?').get(schemeId);

        if (!row) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Scheme not found' }));
          return;
        }

        const scheme = formatSchemeRow(row);
        const targetLang = lang === 'en' ? 'en' : 'ta';

        const explanation = {
          title: scheme.scheme_name[targetLang],
          summary: targetLang === 'ta'
            ? `இத்திட்டம் ${scheme.department} மூலமாக வழங்கப்படுகிறது. இதில் பலன் பெற தகுதிகள்: ${scheme.benefits.ta}.`
            : `Provided by ${scheme.department}. Key Benefit: ${scheme.benefits.en}.`,
          simplifiedRules: targetLang === 'ta'
            ? `1. உங்கள் வயது மற்றும் தொழில் அரசு தகுதிக்கு உட்பட வேண்டும்.\n2. தேவைப்படும் ஆவணங்கள்: ${scheme.required_documents.map(d => d.name.ta).join(', ')}.\n3. ${scheme.official_source_url} போர்ட்டலில் சரிபார்க்கவும்.`
            : `1. Must meet age and occupation guidelines.\n2. Documents: ${scheme.required_documents.map(d => d.name.en).join(', ')}.\n3. Verified at ${scheme.official_source_url}.`,
          disclaimer: "Final eligibility is subject to verification by the respective government department."
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: explanation }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // 6. GET /api/admin/schemes (Admin Dashboard View)
  if (pathname === '/api/admin/schemes' && method === 'GET') {
    try {
      const rows = db.prepare('SELECT * FROM government_schemes ORDER BY last_verified_at DESC').all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: rows.length, data: rows.map(formatSchemeRow) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 7. POST /api/admin/verify (Admin Verification Date Update)
  if (pathname === '/api/admin/verify' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { schemeId, verifyDate, activeStatus } = JSON.parse(body || '{}');
        const today = verifyDate || new Date().toLocaleDateString('en-GB');

        if (schemeId === 'ALL') {
          db.prepare("UPDATE government_schemes SET last_verified_at = ?, active_status = COALESCE(?, active_status)").run(today, activeStatus || 'ACTIVE');
        } else {
          db.prepare("UPDATE government_schemes SET last_verified_at = ?, active_status = COALESCE(?, active_status) WHERE id = ?").run(today, activeStatus, schemeId);
        }

        // Sync back to schemes.json file
        const allRows = db.prepare('SELECT * FROM government_schemes').all().map(formatSchemeRow);
        saveData(SCHEMES_FILE, allRows);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Verification status updated successfully' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // 8. POST /api/admin/import (Admin JSON/CSV Data Import Architecture)
  if (pathname === '/api/admin/import' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const schemesToImport = Array.isArray(payload.schemes) ? payload.schemes : [payload];

        seedSchemesToDB(schemesToImport);

        // Sync back to schemes.json
        const allRows = db.prepare('SELECT * FROM government_schemes').all().map(formatSchemeRow);
        saveData(SCHEMES_FILE, allRows);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, importedCount: schemesToImport.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Import failed: ' + e.message }));
      }
    });
    return;
  }

  // 9. GET /api/admin/export (Admin JSON/CSV Export)
  if (pathname === '/api/admin/export' && method === 'GET') {
    try {
      const rows = db.prepare('SELECT * FROM government_schemes').all().map(formatSchemeRow);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="government_schemes_export.json"'
      });
      res.end(JSON.stringify(rows, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // 10. GET /api/centres
  if (pathname === '/api/centres' && method === 'GET') {
    const centres = loadData(CENTRES_FILE);
    const { district, type } = parsedUrl.query;

    let filtered = centres;
    if (district) {
      filtered = filtered.filter(c => c.district.toLowerCase() === district.toLowerCase());
    }
    if (type && type !== 'all') {
      filtered = filtered.filter(c => c.type === type);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: filtered.length, data: filtered }));
    return;
  }

  // Static File Server (index.html, assets)
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const extname = String(path.extname(filePath)).toLowerCase();

  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, indexContent) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent, 'utf-8');
        });
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`SchemeFinder API Server & SQLite DB running at http://localhost:${PORT}/`);
});
