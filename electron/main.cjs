const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let db;
let win;
let session = null; // { id, username, role }

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const weekStart = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
const num = (v) => Number(v);

function need(adminOnly) {
  if (!session) throw new Error('Please log in first.');
  if (adminOnly && session.role !== 'admin') throw new Error('Only the administrator can do this.');
}

/* ---------- SQLite (sql.js: pure JavaScript/WASM, nothing to compile) ---------- */
const bindArgs = (args) => {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return Object.fromEntries(Object.entries(args[0]).map(([k, v]) => ['@' + k, v === undefined ? null : v]));
  }
  return args.map((v) => (v === undefined ? null : v));
};

class DB {
  constructor(sqlDb, file) {
    this.d = sqlDb;
    this.file = file;
    this.depth = 0;
  }
  persist() {
    if (this.depth > 0) return;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.d.export()));
    fs.renameSync(tmp, this.file);
  }
  exec(sql) {
    this.d.exec(sql);
    this.persist();
  }
  prepare(sql) {
    const self = this;
    const all = (...a) => {
      const s = self.d.prepare(sql);
      try {
        const b = bindArgs(a);
        if (Array.isArray(b) ? b.length : true) s.bind(b);
        const rows = [];
        while (s.step()) rows.push(s.getAsObject());
        return rows;
      } finally {
        s.free();
      }
    };
    return {
      all,
      get: (...a) => all(...a)[0],
      run: (...a) => {
        const s = self.d.prepare(sql);
        try {
          const b = bindArgs(a);
          if (Array.isArray(b) ? b.length : true) s.bind(b);
          s.step();
        } finally {
          s.free();
        }
        const lastInsertRowid = self.d.exec('SELECT last_insert_rowid()')[0].values[0][0];
        self.persist();
        return { lastInsertRowid, changes: self.d.getRowsModified() };
      },
    };
  }
  transaction(fn) {
    return (...a) => {
      this.d.run('BEGIN');
      this.depth++;
      try {
        const r = fn(...a);
        this.d.run('COMMIT');
        this.depth--;
        this.persist();
        return r;
      } catch (e) {
        try { this.d.run('ROLLBACK'); } catch (_) {}
        this.depth--;
        throw e;
      }
    };
  }
  backup(dest) {
    fs.writeFileSync(dest, Buffer.from(this.d.export()));
  }
}

/* ---------- database ---------- */
async function initDb() {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const file = path.join(app.getPath('userData'), 'Magoomu Enterprises(Hardware).db');
  db = new DB(fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database(), file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,            -- stored as plain text (by request)
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      description TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id),
      category TEXT DEFAULT '',
      quantity REAL NOT NULL,
      remaining REAL NOT NULL,
      buy_price REAL NOT NULL,
      sell_price REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      expiry_date TEXT DEFAULT '',
      reorder_level REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      unit TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      customer TEXT DEFAULT '',
      sold_by TEXT NOT NULL,
      sold_at TEXT NOT NULL,
      sale_date TEXT NOT NULL
    );
  `);
}

/* ---------- API handlers ---------- */
const NOT_EXPIRED = `(s.expiry_date IS NULL OR s.expiry_date = '' OR s.expiry_date >= @today)`;

const handlers = {
  /* auth */
  hasUsers: () => db.prepare('SELECT COUNT(*) c FROM users').get().c > 0,

  register({ username, password }) {
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0)
      throw new Error('Registration is closed. Ask the administrator to add you.');
    if (!username?.trim() || !password) throw new Error('Enter a username and password.');
    const r = db
      .prepare('INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username.trim(), password, 'admin', new Date().toISOString());
    session = { id: r.lastInsertRowid, username: username.trim(), role: 'admin' };
    return session;
  },

  login({ username, password }) {
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get((username || '').trim(), password || '');
    if (!u) throw new Error('Wrong username or password.');
    session = { id: u.id, username: u.username, role: u.role };
    return session;
  },

  logout() {
    session = null;
    return true;
  },

  changePassword({ current, next }) {
    need();
    if (!next || next.length < 4) throw new Error('New password must be at least 4 characters.');
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(session.id);
    if (u.password !== current) throw new Error('Current password is incorrect.');
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(next, session.id);
    return true;
  },

  /* users (admin) */
  listUsers() {
    need(true);
    return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  },

  addUser({ username, password, role }) {
    need(true);
    if (!username?.trim() || !password) throw new Error('Enter a username and password.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username.trim())) throw new Error('That username already exists.');
    db.prepare('INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)').run(
      username.trim(),
      password,
      role === 'admin' ? 'admin' : 'user',
      new Date().toISOString()
    );
    return true;
  },

  deleteUser({ id }) {
    need(true);
    if (id === session.id) throw new Error('You cannot delete your own account.');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return true;
  },

  /* items (admin) */
  listItems() {
    need(true);
    return db.prepare('SELECT * FROM items ORDER BY id').all();
  },

  saveItem({ id, name, unit, description }) {
    need(true);
    if (!name?.trim() || !unit?.trim()) throw new Error('Item name and unit of measure are required.');
    if (id) db.prepare('UPDATE items SET name=?, unit=?, description=? WHERE id=?').run(name.trim(), unit.trim(), description || '', id);
    else db.prepare('INSERT INTO items (name, unit, description) VALUES (?,?,?)').run(name.trim(), unit.trim(), description || '');
    return true;
  },

  deleteItem({ id }) {
    need(true);
    db.transaction(() => {
      db.prepare('DELETE FROM stock WHERE item_id = ?').run(id);
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
    })();
    return true;
  },

  /* stock (admin) */
  listStock() {
    need(true);
    return db
      .prepare(
        `SELECT s.*, i.name AS item_name, i.unit FROM stock s
         JOIN items i ON i.id = s.item_id
         ORDER BY i.name COLLATE NOCASE, s.purchase_date, s.id`
      )
      .all();
  },

  saveStock(d) {
    need(true);
    const q = num(d.quantity), bp = num(d.buy_price), sp = num(d.sell_price), rl = num(d.reorder_level || 0);
    if (!d.item_id) throw new Error('Choose an item.');
    if (!(q >= 0) || isNaN(q)) throw new Error('Enter a valid quantity.');
    if (isNaN(bp) || isNaN(sp) || bp < 0 || sp < 0) throw new Error('Enter valid prices.');
    if (!d.purchase_date) throw new Error('Enter the date of purchase.');
    if (d.id) {
      const old = db.prepare('SELECT * FROM stock WHERE id = ?').get(d.id);
      const remaining = Math.max(0, old.remaining + (q - old.quantity));
      db.prepare(
        `UPDATE stock SET item_id=?, category=?, quantity=?, remaining=?, buy_price=?, sell_price=?,
         purchase_date=?, expiry_date=?, reorder_level=? WHERE id=?`
      ).run(d.item_id, d.category || '', q, remaining, bp, sp, d.purchase_date, d.expiry_date || '', rl, d.id);
    } else {
      db.prepare(
        `INSERT INTO stock (item_id, category, quantity, remaining, buy_price, sell_price, purchase_date, expiry_date, reorder_level)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(d.item_id, d.category || '', q, q, bp, sp, d.purchase_date, d.expiry_date || '', rl);
    }
    return true;
  },

  deleteStock({ id }) {
    need(true);
    db.prepare('DELETE FROM stock WHERE id = ?').run(id);
    return true;
  },

  /* sales */
  itemsForSale() {
    need(true);
    return db
      .prepare(
        `SELECT i.id, i.name, i.unit,
           COALESCE(SUM(s.remaining), 0) AS available,
           (SELECT s2.sell_price FROM stock s2 WHERE s2.item_id = i.id AND s2.remaining > 0
              AND (s2.expiry_date IS NULL OR s2.expiry_date = '' OR s2.expiry_date >= @today)
              ORDER BY s2.purchase_date, s2.id LIMIT 1) AS price
         FROM items i
         LEFT JOIN stock s ON s.item_id = i.id AND ${NOT_EXPIRED}
         GROUP BY i.id
         HAVING available > 0
         ORDER BY i.name COLLATE NOCASE`
      )
      .all({ today: today() });
  },

  makeSale({ item_id, quantity, unit_price, customer }) {
    need(true);
    const qty = num(quantity);
    if (!(qty > 0)) throw new Error('Enter a quantity greater than zero.');
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
    if (!item) throw new Error('Choose an item to sell.');

    const run = db.transaction(() => {
      const batches = db
        .prepare(
          `SELECT * FROM stock s WHERE s.item_id = @id AND s.remaining > 0 AND ${NOT_EXPIRED}
           ORDER BY s.purchase_date, s.id`
        )
        .all({ id: item_id, today: today() });
      const available = batches.reduce((a, b) => a + b.remaining, 0);
      if (qty > available) throw new Error(`Only ${available} ${item.unit} in stock.`);
      const price = unit_price !== '' && unit_price != null ? num(unit_price) : batches[0].sell_price;
      if (isNaN(price) || price < 0) throw new Error('Enter a valid unit price.');

      let left = qty;
      for (const b of batches) {
        if (left <= 0) break;
        const take = Math.min(left, b.remaining);
        db.prepare('UPDATE stock SET remaining = remaining - ? WHERE id = ?').run(take, b.id);
        left -= take;
      }
      const now = new Date();
      const r = db
        .prepare(
          `INSERT INTO sales (item_id, item_name, unit, quantity, unit_price, total, customer, sold_by, sold_at, sale_date)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(item.id, item.name, item.unit, qty, price, qty * price, customer || '', session.username, now.toISOString(), ymd(now));
      const receipt = 'RCT-' + String(r.lastInsertRowid).padStart(5, '0');
      db.prepare('UPDATE sales SET receipt_no = ? WHERE id = ?').run(receipt, r.lastInsertRowid);
      return r.lastInsertRowid;
    });
    const id = run();
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  },

  listSales({ period } = {}) {
    need();
    // Non-admin users can only see today's sales.
    const p = session.role === 'admin' ? period || 'recent' : 'today';
    const now = new Date();
    if (p === 'today') return db.prepare('SELECT * FROM sales WHERE sale_date = ? ORDER BY id DESC').all(today());
    if (p === 'week') return db.prepare('SELECT * FROM sales WHERE sale_date >= ? ORDER BY id DESC').all(ymd(weekStart(now)));
    if (p === 'month')
      return db.prepare('SELECT * FROM sales WHERE sale_date >= ? ORDER BY id DESC').all(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
    return db.prepare('SELECT * FROM sales ORDER BY id DESC LIMIT 100').all();
  },

  getSale({ id }) {
    need();
    const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!s) throw new Error('Sale not found.');
    if (session.role !== 'admin' && s.sale_date !== today()) throw new Error('You can only view today\'s receipts.');
    return s;
  },

  /* dashboard + graphs */
  report() {
    need();
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 400);
    const rows = db.prepare('SELECT sale_date d, SUM(total) t FROM sales WHERE sale_date >= ? GROUP BY sale_date').all(ymd(from));
    const byDay = Object.fromEntries(rows.map((r) => [r.d, r.t]));
    const sumDays = (start, count) => {
      let t = 0;
      for (let i = 0; i < count; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        t += byDay[ymd(d)] || 0;
      }
      return t;
    };

    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      daily.push({ label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }), value: byDay[ymd(d)] || 0 });
    }
    const weekly = [];
    const ws = weekStart(now);
    for (let i = 7; i >= 0; i--) {
      const s = new Date(ws);
      s.setDate(s.getDate() - 7 * i);
      weekly.push({ label: s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: sumDays(s, 7) });
    }
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const prefix = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
      const value = Object.entries(byDay).reduce((a, [k, v]) => (k.startsWith(prefix) ? a + v : a), 0);
      monthly.push({ label: m.toLocaleDateString('en-GB', { month: 'short' }), value });
    }

    const t = db.prepare('SELECT COALESCE(SUM(total),0) total, COUNT(*) count FROM sales WHERE sale_date = ?').get(today());
    const out = { todayTotal: t.total, todayCount: t.count, daily, weekly, monthly };

    if (session.role === 'admin') {
      out.itemCount = db.prepare('SELECT COUNT(*) c FROM items').get().c;
      out.stockValue = db.prepare('SELECT COALESCE(SUM(remaining * buy_price),0) v FROM stock').get().v;
      out.lowStock = db
        .prepare(
          `SELECT COUNT(*) c FROM (SELECT i.id FROM items i JOIN stock s ON s.item_id = i.id
           GROUP BY i.id HAVING SUM(s.remaining) <= MAX(s.reorder_level))`
        )
        .get().c;
    }
    return out;
  },

  /* backup (admin) */
  async exportBackup() {
    need(true);
    const r = await dialog.showSaveDialog(win, {
      title: 'Export backup',
      defaultPath: `Magoomu Enterprises(Hardware) backup ${today()}.db`,
      filters: [{ name: 'Database', extensions: ['db'] }],
    });
    if (r.canceled || !r.filePath) return false;
    await db.backup(r.filePath);
    return true;
  },
};

ipcMain.handle('api', async (_e, name, args) => {
  try {
    if (!handlers[name]) throw new Error('Unknown action: ' + name);
    return { ok: true, data: await handlers[name](args || {}) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    title: 'Magoomu Enterprises(Hardware)',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (app.isPackaged) win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else win.loadURL('http://localhost:5173');
}

app.whenReady().then(async () => {
  await initDb();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
