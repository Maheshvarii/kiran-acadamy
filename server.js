require('dotenv').config();

const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;

if (!process.env.DATABASE_URL || !jwtSecret || jwtSecret.length < 32) {
  console.error('Set DATABASE_URL and a JWT_SECRET of at least 32 characters in .env.');
  process.exit(1);
}

const databaseUrl = new URL(process.env.DATABASE_URL);
const pool = mysql.createPool({
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: decodeURIComponent(databaseUrl.pathname.slice(1)),
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const courseSeeds = [
  {
    slug: 'java-full-stack', title: 'Java Full Stack', category: 'Development',
    summary: 'Build production-ready applications from database to interface.',
    description: 'A practical, mentor-led path through Java, Spring Boot, SQL, APIs and modern frontend fundamentals. Learn by shipping projects that look and behave like real software.',
    duration: '6 months', fee: 42000, level: 'Beginner to job-ready', featured: 1,
    modules: ['Java foundations & OOP', 'SQL, JDBC & database design', 'HTML, CSS & JavaScript', 'Spring Boot & REST APIs', 'React essentials', 'Capstone, Git & interview studio'],
    resources: [['Java documentation', 'https://dev.java/learn/'], ['Spring guides', 'https://spring.io/guides'], ['SQL practice', 'https://sqlbolt.com/']]
  },
  {
    slug: 'python-full-stack', title: 'Python Full Stack', category: 'Development',
    summary: 'Turn Python fundamentals into complete, deployable web products.',
    description: 'Go from confident Python basics to Django applications, data-backed APIs and polished web interfaces, with regular reviews and a portfolio project.',
    duration: '5 months', fee: 38000, level: 'Beginner friendly', featured: 1,
    modules: ['Python core & problem solving', 'HTML, CSS & JavaScript', 'Django & REST framework', 'SQL and data modeling', 'Testing & deployment', 'Portfolio and interview practice'],
    resources: [['Python tutorial', 'https://docs.python.org/3/tutorial/'], ['Django documentation', 'https://docs.djangoproject.com/en/stable/'], ['Git handbook', 'https://guides.github.com/introduction/git-handbook/']]
  },
  {
    slug: 'data-analytics', title: 'Data Analytics', category: 'Data',
    summary: 'Find the signal in real-world data and make it useful.',
    description: 'Develop practical skills in spreadsheets, SQL, Python and dashboard storytelling. Work through case studies that mirror the questions analysts solve every day.',
    duration: '4 months', fee: 32000, level: 'Beginner friendly', featured: 0,
    modules: ['Data thinking & spreadsheets', 'SQL for analysis', 'Python with pandas', 'Exploratory data analysis', 'Dashboard storytelling', 'Analytics capstone'],
    resources: [['Pandas user guide', 'https://pandas.pydata.org/docs/user_guide/'], ['Kaggle datasets', 'https://www.kaggle.com/datasets'], ['SQL practice', 'https://sqlbolt.com/']]
  },
  {
    slug: 'software-testing', title: 'Software Testing', category: 'Quality Engineering',
    summary: 'Ship with confidence through thoughtful test strategy and automation.',
    description: 'Learn how to design meaningful test cases, automate browser workflows and communicate risk clearly across a modern software team.',
    duration: '3 months', fee: 28000, level: 'Beginner friendly', featured: 0,
    modules: ['Testing foundations', 'Test case design', 'API testing', 'Automation with Selenium', 'CI workflows', 'Quality engineering project'],
    resources: [['Selenium documentation', 'https://www.selenium.dev/documentation/'], ['Postman learning center', 'https://learning.postman.com/'], ['ISTQB glossary', 'https://glossary.istqb.org/']]
  }
];

function cleanText(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return sendError(res, 401, 'Please sign in to continue.');

  let claims;
  try {
    claims = jwt.verify(token, jwtSecret);
  } catch {
    return sendError(res, 401, 'Your session has expired. Please sign in again.');
  }

  try {
    const [[user]] = await pool.execute('SELECT role, active FROM users WHERE id = ?', [claims.id]);
    if (!user || !user.active) return sendError(res, 401, 'This account is not active.');
    req.auth = { ...claims, role: user.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

const requireAdmin = [requireAuth, (req, res, next) => {
  if (req.auth.role !== 'admin') return sendError(res, 403, 'Administrator access required.');
  return next();
}];

const requireStudent = [requireAuth, (req, res, next) => {
  if (req.auth.role !== 'student') return sendError(res, 403, 'Student access required.');
  return next();
}];

async function publicCourse(course) {
  const [modules] = await pool.execute(
    'SELECT id, title, position FROM syllabus_modules WHERE course_id = ? ORDER BY position',
    [course.id]
  );
  const [batches] = await pool.execute(
    'SELECT id, name, starts_on, schedule, seats FROM batches WHERE course_id = ? AND active = 1 ORDER BY starts_on LIMIT 5',
    [course.id]
  );
  return { ...course, modules, batches };
}

async function seedDatabase() {
  for (const seed of courseSeeds) {
    await pool.execute(
      `INSERT INTO courses (slug, title, category, summary, description, duration, fee, level, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE slug = VALUES(slug)`,
      [seed.slug, seed.title, seed.category, seed.summary, seed.description, seed.duration, seed.fee, seed.level, seed.featured]
    );
    const [[course]] = await pool.execute('SELECT id FROM courses WHERE slug = ?', [seed.slug]);
    const [[moduleCount]] = await pool.execute('SELECT COUNT(*) AS total FROM syllabus_modules WHERE course_id = ?', [course.id]);
    if (!moduleCount.total) {
      for (const [position, title] of seed.modules.entries()) {
        await pool.execute('INSERT INTO syllabus_modules (course_id, title, position) VALUES (?, ?, ?)', [course.id, title, position + 1]);
      }
    }
    const [[resourceCount]] = await pool.execute('SELECT COUNT(*) AS total FROM learning_resources WHERE course_id = ?', [course.id]);
    if (!resourceCount.total) {
      for (const [position, [title, url]] of seed.resources.entries()) {
        await pool.execute('INSERT INTO learning_resources (course_id, title, url, position) VALUES (?, ?, ?, ?)', [course.id, title, url, position + 1]);
      }
    }
    const [[batchCount]] = await pool.execute('SELECT COUNT(*) AS total FROM batches WHERE course_id = ?', [course.id]);
    if (!batchCount.total) {
      const startsOn = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      await pool.execute(
        'INSERT INTO batches (course_id, name, starts_on, schedule, seats) VALUES (?, ?, ?, ?, ?)',
        [course.id, 'Weekend cohort', startsOn, 'Sat & Sun · 10:00 AM – 1:00 PM', 24]
      );
    }
  }

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await pool.execute(
      `INSERT IGNORE INTO users (name, email, password_hash, role)
       VALUES (?, ?, ?, 'admin')`,
      [process.env.ADMIN_NAME || 'Academy Admin', process.env.ADMIN_EMAIL.toLowerCase(), hash]
    );
  }
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/api/courses', asyncRoute(async (req, res) => {
  const search = `%${cleanText(req.query.search, 100)}%`;
  const category = cleanText(req.query.category, 80);
  const [courses] = await pool.execute(
    `SELECT id, slug, title, category, summary, description, duration, fee, level, format, featured
     FROM courses WHERE active = 1 AND (? = '%%' OR title LIKE ? OR summary LIKE ?)
       AND (? = '' OR category = ?) ORDER BY featured DESC, title`,
    [search, search, search, category, category]
  );
  res.json({ courses });
}));

app.get('/api/courses/:slug', asyncRoute(async (req, res) => {
  const [[course]] = await pool.execute(
    'SELECT id, slug, title, category, summary, description, duration, fee, level, format, featured FROM courses WHERE slug = ? AND active = 1',
    [req.params.slug]
  );
  if (!course) return sendError(res, 404, 'Course not found.');
  const detailed = await publicCourse(course);
  const [resources] = await pool.execute(
    'SELECT id, title, url FROM learning_resources WHERE course_id = ? ORDER BY position',
    [course.id]
  );
  res.json({ course: { ...detailed, resources } });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 120);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const phone = cleanText(req.body.phone, 30);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return sendError(res, 400, 'Enter your name, a valid email and a password of at least 8 characters.');
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
      [name, email, phone || null, hash]
    );
    const user = { id: result.insertId, name, email, phone, role: 'student' };
    const token = jwt.sign({ id: user.id, email, role: user.role }, jwtSecret, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return sendError(res, 409, 'An account with this email already exists.');
    throw error;
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const [[user]] = await pool.execute(
    'SELECT id, name, email, phone, password_hash, role, active FROM users WHERE email = ?',
    [email]
  );
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    return sendError(res, 401, 'Email or password is incorrect.');
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }
  });
}));

app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const [[user]] = await pool.execute('SELECT id, name, email, phone, role FROM users WHERE id = ? AND active = 1', [req.auth.id]);
  if (!user) return sendError(res, 401, 'Account is not available.');
  res.json({ user });
}));

app.post('/api/enquiries', asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 120);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const phone = cleanText(req.body.phone, 30);
  const message = cleanText(req.body.message, 2000);
  const courseId = Number(req.body.courseId) || null;
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7 || message.length < 10) {
    return sendError(res, 400, 'Please complete each field and include a little more detail in your message.');
  }
  await pool.execute(
    'INSERT INTO enquiries (name, email, phone, course_id, message) VALUES (?, ?, ?, ?, ?)',
    [name, email, phone, courseId, message]
  );
  res.status(201).json({ message: 'Thanks. Our admissions team will be in touch soon.' });
}));

app.post('/api/student/enrollments', requireStudent, asyncRoute(async (req, res) => {
  const courseId = Number(req.body.courseId);
  const batchId = Number(req.body.batchId) || null;
  if (!Number.isInteger(courseId) || courseId < 1) return sendError(res, 400, 'Choose a valid course.');
  const [[course]] = await pool.execute('SELECT id FROM courses WHERE id = ? AND active = 1', [courseId]);
  if (!course) return sendError(res, 404, 'Course not found.');
  if (batchId) {
    const [[batch]] = await pool.execute('SELECT id FROM batches WHERE id = ? AND course_id = ? AND active = 1', [batchId, courseId]);
    if (!batch) return sendError(res, 400, 'That batch is no longer available.');
  }
  try {
    await pool.execute(
      'INSERT INTO enrollments (user_id, course_id, batch_id) VALUES (?, ?, ?)',
      [req.auth.id, courseId, batchId]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return sendError(res, 409, 'You already requested a place on this course.');
    throw error;
  }
  res.status(201).json({ message: 'Enrollment request received. The team will confirm your place.' });
}));

app.get('/api/student/dashboard', requireStudent, asyncRoute(async (req, res) => {
  const [enrollments] = await pool.execute(
    `SELECT e.id, e.status, e.enrolled_at, c.id AS course_id, c.slug, c.title, c.category, c.duration,
      b.name AS batch_name, b.starts_on, b.schedule
     FROM enrollments e JOIN courses c ON c.id = e.course_id
     LEFT JOIN batches b ON b.id = e.batch_id
     WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`,
    [req.auth.id]
  );
  for (const enrollment of enrollments) {
    const [resources] = await pool.execute(
      'SELECT title, url FROM learning_resources WHERE course_id = ? ORDER BY position',
      [enrollment.course_id]
    );
    enrollment.resources = resources;
  }
  res.json({ enrollments });
}));

app.get('/api/admin/overview', requireAdmin, asyncRoute(async (_req, res) => {
  const [[students]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'student'");
  const [[activeCourses]] = await pool.query('SELECT COUNT(*) AS total FROM courses WHERE active = 1');
  const [[newEnquiries]] = await pool.query("SELECT COUNT(*) AS total FROM enquiries WHERE status = 'new'");
  const [[enrollments]] = await pool.query('SELECT COUNT(*) AS total FROM enrollments');
  res.json({ students: students.total, courses: activeCourses.total, newEnquiries: newEnquiries.total, enrollments: enrollments.total });
}));

app.get('/api/admin/students', ...requireAdmin, asyncRoute(async (_req, res) => {
  const [students] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at,
      COUNT(e.id) AS enrollment_count
     FROM users u LEFT JOIN enrollments e ON e.user_id = u.id
     WHERE u.role = 'student' GROUP BY u.id ORDER BY u.created_at DESC LIMIT 300`
  );
  res.json({ students });
}));

app.patch('/api/admin/students/:id', ...requireAdmin, asyncRoute(async (req, res) => {
  const active = req.body.active;
  if (typeof active !== 'boolean') return sendError(res, 400, 'Provide an active status.');
  const [result] = await pool.execute("UPDATE users SET active = ? WHERE id = ? AND role = 'student'", [active, Number(req.params.id)]);
  if (!result.affectedRows) return sendError(res, 404, 'Student not found.');
  res.json({ message: 'Student access updated.' });
}));

app.get('/api/admin/enquiries', ...requireAdmin, asyncRoute(async (_req, res) => {
  const [enquiries] = await pool.query(
    `SELECT e.id, e.name, e.email, e.phone, e.message, e.status, e.created_at, c.title AS course_title
     FROM enquiries e LEFT JOIN courses c ON c.id = e.course_id ORDER BY e.created_at DESC LIMIT 300`
  );
  res.json({ enquiries });
}));

app.patch('/api/admin/enquiries/:id', ...requireAdmin, asyncRoute(async (req, res) => {
  const status = cleanText(req.body.status, 20);
  if (!['new', 'contacted', 'closed'].includes(status)) return sendError(res, 400, 'Choose a valid enquiry status.');
  const [result] = await pool.execute('UPDATE enquiries SET status = ? WHERE id = ?', [status, Number(req.params.id)]);
  if (!result.affectedRows) return sendError(res, 404, 'Enquiry not found.');
  res.json({ message: 'Enquiry updated.' });
}));

app.get('/api/admin/courses', ...requireAdmin, asyncRoute(async (_req, res) => {
  const [courses] = await pool.query('SELECT id, slug, title, category, duration, fee, active FROM courses ORDER BY title');
  res.json({ courses });
}));

app.post('/api/admin/courses', ...requireAdmin, asyncRoute(async (req, res) => {
  const title = cleanText(req.body.title, 160);
  const slug = cleanText(req.body.slug, 120).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const category = cleanText(req.body.category, 80);
  const summary = cleanText(req.body.summary, 500);
  const description = cleanText(req.body.description, 3000);
  const duration = cleanText(req.body.duration, 80);
  const fee = Number(req.body.fee);
  const modules = Array.isArray(req.body.modules)
    ? req.body.modules.map((module) => cleanText(module, 180)).filter(Boolean).slice(0, 30)
    : [];
  const batchStart = cleanText(req.body.batchStart, 10);
  const batchSchedule = cleanText(req.body.batchSchedule, 180);
  if (!title || !slug || !category || !summary || !description || !duration || !Number.isFinite(fee) || fee < 0) {
    return sendError(res, 400, 'Complete all course fields with a valid fee.');
  }
  if (!modules.length || !/^\d{4}-\d{2}-\d{2}$/.test(batchStart) || !batchSchedule) {
    return sendError(res, 400, 'Add at least one syllabus module and complete the first batch details.');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO courses (slug, title, category, summary, description, duration, fee, level, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [slug, title, category, summary, description, duration, fee, cleanText(req.body.level, 80) || 'Beginner friendly']
    );
    for (const [position, module] of modules.entries()) {
      await connection.execute('INSERT INTO syllabus_modules (course_id, title, position) VALUES (?, ?, ?)', [result.insertId, module, position + 1]);
    }
    await connection.execute(
      'INSERT INTO batches (course_id, name, starts_on, schedule, seats) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, 'First cohort', batchStart, batchSchedule, 24]
    );
    await connection.commit();
    res.status(201).json({ id: result.insertId, message: 'Course created.' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return sendError(res, 409, 'A course with that URL slug already exists.');
    throw error;
  } finally {
    connection.release();
  }
}));

app.patch('/api/admin/courses/:id', ...requireAdmin, asyncRoute(async (req, res) => {
  if (typeof req.body.active !== 'boolean') return sendError(res, 400, 'Provide an active status.');
  const [result] = await pool.execute('UPDATE courses SET active = ? WHERE id = ?', [req.body.active, Number(req.params.id)]);
  if (!result.affectedRows) return sendError(res, 404, 'Course not found.');
  res.json({ message: 'Course visibility updated.' });
}));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'web.html')));
app.get('/api/*', (_req, res) => sendError(res, 404, 'API route not found.'));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code === 'ER_NO_REFERENCED_ROW_2') return sendError(res, 400, 'The selected record is not available.');
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function start() {
  await pool.query('SELECT 1');
  await seedDatabase();
  app.listen(port, () => console.log(`Kiran Academy is running at http://localhost:${port}`));
}

start().catch((error) => {
  console.error('Could not start Kiran Academy. Check DATABASE_URL and run schema.sql first.', error.message);
  process.exit(1);
});