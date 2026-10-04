import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const SHOP_NAME = 'Magoomu Enterprises(Hardware)';
const UNITS = ['piece', 'bag', 'box', 'roll', 'sheet', 'length', 'bucket', 'kg', 'tonne', 'litre', 'metre', 'pair', 'packet', 'dozen', 'bundle'];

/* ---------- helpers ---------- */
async function api(name, args) {
  const r = await window.api.call(name, args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
const money = (n) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-GB');
const qtyFmt = (n) => Number(Number(n).toFixed(2)).toString();
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const longDate = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDateTime = (iso) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------- shared UI ---------- */
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PageHeader({ title, action }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p className="muted">{longDate()}</p>
      </div>
      {action}
    </div>
  );
}

function Card({ title, right, children }) {
  return (
    <section className="card">
      <div className="card-head">
        <strong>{title}</strong>
        <span className="muted">{right}</span>
      </div>
      {children}
    </section>
  );
}

function BarChart({ data }) {
  const W = 640, H = 260, pl = 10, pb = 34, pt = 24;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W - pl * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pl} x2={W - pl} y1={pt + (H - pt - pb) * (1 - f)} y2={pt + (H - pt - pb) * (1 - f)} className="grid" />
      ))}
      {data.map((d, i) => {
        const h = ((H - pt - pb) * d.value) / max;
        const x = pl + i * bw + bw * 0.18;
        return (
          <g key={i}>
            <rect x={x} y={H - pb - h} width={bw * 0.64} height={Math.max(h, 1)} rx="5" className="bar" />
            {d.value > 0 && (
              <text x={x + bw * 0.32} y={H - pb - h - 6} textAnchor="middle" className="val">
                {d.value >= 1000 ? Math.round(d.value / 1000) + 'k' : Math.round(d.value)}
              </text>
            )}
            <text x={x + bw * 0.32} y={H - 12} textAnchor="middle" className="lbl">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    fn().then(setData).catch((e) => setError(e.message));
  }, deps); // eslint-disable-line
  useEffect(load, [load]);
  return [data, load, error];
}

/* ---------- login ---------- */
function Login({ onLogin }) {
  const [hasUsers, setHasUsers] = useState(true);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('hasUsers').then((h) => { setHasUsers(h); setRegister(!h); });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      onLogin(await api(register ? 'register' : 'login', { username, password }));
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-mark" />
        <h1>{SHOP_NAME}</h1>
        <p className="muted center">{register ? 'Create the administrator account' : 'Sign in to manage your shop'}</p>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" type="submit">{register ? 'Create admin & log in' : 'Log in'}</button>
        {!hasUsers && (
          <button type="button" className="link" onClick={() => setRegister(!register)}>
            {register ? 'Back to log in' : 'First time? Register'}
          </button>
        )}
      </form>
    </div>
  );
}

/* ---------- dashboard ---------- */
function Dashboard({ user }) {
  const [r] = useLoad(() => api('report'));
  const [view, setView] = useState('daily');
  if (!r) return null;
  const titles = { daily: 'Last 7 days', weekly: 'Last 8 weeks', monthly: 'Last 12 months' };
  const sum = r[view].reduce((a, b) => a + b.value, 0);
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="stats">
        <div className="stat"><span>Today's sales</span><b>{money(r.todayTotal)}</b></div>
        <div className="stat"><span>Transactions today</span><b>{r.todayCount}</b></div>
        {user.role === 'admin' && (
          <>
            <div className="stat"><span>Stock value (cost)</span><b>{money(r.stockValue)}</b></div>
            <div className={'stat' + (r.lowStock ? ' warn' : '')}><span>Low stock items</span><b>{r.lowStock}</b></div>
          </>
        )}
      </div>
      <Card title="Sales report" right={`${titles[view]} · ${money(sum)}`}>
        <div className="tabs">
          {['daily', 'weekly', 'monthly'].map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <BarChart data={r[view]} />
      </Card>
    </>
  );
}

/* ---------- receipt ---------- */
function Receipt({ id, onClose }) {
  const [s, , err] = useLoad(() => api('getSale', { id }), [id]);
  return (
    <Modal title="Receipt" onClose={onClose}>
      {err && <div className="error">{err}</div>}
      {s && (
        <>
          <div className="receipt">
            <h2>{SHOP_NAME}</h2>
            <p className="center muted">Sales receipt</p>
            <div className="rline"><span>Receipt no.</span><b>{s.receipt_no}</b></div>
            <div className="rline"><span>Date</span><b>{shortDateTime(s.sold_at)}</b></div>
            <div className="rline"><span>Served by</span><b>{s.sold_by}</b></div>
            {s.customer && <div className="rline"><span>Customer</span><b>{s.customer}</b></div>}
            <hr />
            <div className="rline"><span>{s.item_name}</span></div>
            <div className="rline">
              <span>{qtyFmt(s.quantity)} {s.unit} × {money(s.unit_price)}</span>
              <b>{money(s.total)}</b>
            </div>
            <hr />
            <div className="rline total"><span>TOTAL</span><b>{money(s.total)}</b></div>
            <p className="center muted thanks">Thank you for shopping with us!</p>
          </div>
          <div className="actions-row">
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn primary" onClick={() => window.print()}>Print receipt</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------- sales ---------- */
function SaleForm({ onClose, onDone }) {
  const [items] = useLoad(() => api('itemsForSale'));
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [customer, setCustomer] = useState('');
  const [err, setErr] = useState('');
  const item = (items || []).find((i) => String(i.id) === String(itemId));
  const total = (Number(qty) || 0) * (Number(price) || 0);

  const pick = (id) => {
    setItemId(id);
    const it = items.find((i) => String(i.id) === String(id));
    setPrice(it ? String(it.price ?? '') : '');
  };
  const save = async () => {
    try {
      onDone(await api('makeSale', { item_id: Number(itemId), quantity: qty, unit_price: price, customer }));
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <Modal title="New sale" onClose={onClose}>
      <label>Item</label>
      <select value={itemId} onChange={(e) => pick(e.target.value)}>
        <option value="">Select the item</option>
        {(items || []).map((i) => (
          <option key={i.id} value={i.id}>{i.name} — {qtyFmt(i.available)} {i.unit} available</option>
        ))}
      </select>
      <div className="grid2">
        <div>
          <label>Quantity {item && `(${item.unit})`}</label>
          <input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label>Unit price (UGX)</label>
          <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <label>Customer name (optional)</label>
      <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
      <div className="sale-total">Total <b>{money(total)}</b></div>
      {err && <div className="error">{err}</div>}
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Complete sale</button>
      </div>
    </Modal>
  );
}

function Sales({ user }) {
  const admin = user.role === 'admin';
  const [period, setPeriod] = useState('recent');
  const [rows, load] = useLoad(() => api('listSales', { period }), [period]);
  const [newSale, setNewSale] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const total = (rows || []).reduce((a, s) => a + s.total, 0);
  return (
    <>
      <PageHeader
        title={admin ? 'Sales' : "Today's sales"}
        action={admin && <button className="btn primary" onClick={() => setNewSale(true)}>New sale</button>}
      />
      <Card
        title={admin ? 'Recent sales' : 'Sales made today'}
        right={
          admin ? (
            <select className="inline" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="recent">Last 100</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          ) : (
            `Total ${money(total)}`
          )
        }
      >
        <table>
          <thead>
            <tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Total</th><th>Sold by</th><th>Date</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {(rows || []).map((s) => (
              <tr key={s.id}>
                <td className="strong">{s.item_name}</td>
                <td>{qtyFmt(s.quantity)} {s.unit}</td>
                <td>{money(s.unit_price)}</td>
                <td className="strong">{money(s.total)}</td>
                <td>{s.sold_by}</td>
                <td>{shortDateTime(s.sold_at)}</td>
                <td><button className="btn sm" onClick={() => setReceipt(s.id)}>Receipt</button></td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan="7" className="empty">No sales to show.</td></tr>}
          </tbody>
        </table>
        {admin && rows && rows.length > 0 && <div className="foot">Total for this list: <b>{money(total)}</b></div>}
      </Card>
      {newSale && (
        <SaleForm
          onClose={() => setNewSale(false)}
          onDone={(sale) => { setNewSale(false); load(); setReceipt(sale.id); }}
        />
      )}
      {receipt && <Receipt id={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

/* ---------- stock ---------- */
function StockForm({ row, items, onClose, onDone }) {
  const [f, setF] = useState(
    row || { item_id: '', category: '', quantity: '', buy_price: '', sell_price: '', purchase_date: todayStr(), expiry_date: '', reorder_level: 5 }
  );
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      await api('saveStock', { ...f, item_id: Number(f.item_id) });
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  };
  const unit = (items.find((i) => String(i.id) === String(f.item_id)) || {}).unit;
  return (
    <Modal title={row ? 'Edit stock' : 'Add stock'} onClose={onClose} wide>
      <label>Item</label>
      <select value={f.item_id} onChange={set('item_id')}>
        <option value="">Select the item</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.unit}</option>)}
      </select>
      <div className="grid2">
        <div><label>Category</label><input value={f.category} onChange={set('category')} placeholder="e.g. Roofing" /></div>
        <div><label>Quantity {unit && `(${unit})`}</label><input type="number" min="0" value={f.quantity} onChange={set('quantity')} /></div>
        <div><label>Purchasing price (UGX)</label><input type="number" min="0" value={f.buy_price} onChange={set('buy_price')} /></div>
        <div><label>Selling price (UGX)</label><input type="number" min="0" value={f.sell_price} onChange={set('sell_price')} /></div>
        <div><label>Date of purchase</label><input type="date" value={f.purchase_date} onChange={set('purchase_date')} /></div>
        <div><label>Expiry date (optional)</label><input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></div>
        <div><label>Reorder at</label><input type="number" min="0" value={f.reorder_level} onChange={set('reorder_level')} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

function Stock() {
  const [rows, load] = useLoad(() => api('listStock'));
  const [items] = useLoad(() => api('listItems'));
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // null | {} | row
  const today = todayStr();
  const list = (rows || []).filter((r) =>
    [r.item_name, r.category, r.unit].some((v) => (v || '').toLowerCase().includes(q.toLowerCase()))
  );
  const del = async (r) => {
    if (confirm(`Delete this stock entry for "${r.item_name}"?`)) { await api('deleteStock', { id: r.id }); load(); }
  };
  return (
    <>
      <PageHeader title="Stock" action={<button className="btn primary" onClick={() => setForm({})}>Add Stock</button>} />
      <Card title="Stock items" right={`${list.length} entries`}>
        <input className="search" placeholder="Search stock by item, category, or unit" value={q} onChange={(e) => setQ(e.target.value)} />
        <table>
          <thead>
            <tr><th>Item</th><th>Category</th><th>In stock</th><th>Price</th><th>Reorder at</th><th>Expiry</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const low = r.remaining <= r.reorder_level;
              const expired = r.expiry_date && r.expiry_date < today;
              return (
                <tr key={r.id}>
                  <td className="strong">{r.item_name}</td>
                  <td>{r.category}</td>
                  <td className={low ? 'low' : ''}>{qtyFmt(r.remaining)} {r.unit}</td>
                  <td>{money(r.sell_price)}</td>
                  <td>{qtyFmt(r.reorder_level)}</td>
                  <td>{r.expiry_date ? <span className={expired ? 'chip red' : ''}>{expired ? 'Expired ' : ''}{r.expiry_date}</span> : '—'}</td>
                  <td>
                    <button className="btn sm" onClick={() => setForm(r)}>Edit</button>{' '}
                    <button className="btn sm danger" onClick={() => del(r)}>Delete</button>
                  </td>
                </tr>
              );
            })}
            {rows && list.length === 0 && <tr><td colSpan="7" className="empty">No stock yet. Click “Add Stock”.</td></tr>}
          </tbody>
        </table>
      </Card>
      {form && items && (
        <StockForm row={form.id ? form : null} items={items} onClose={() => setForm(null)} onDone={() => { setForm(null); load(); }} />
      )}
    </>
  );
}

/* ---------- items ---------- */
function ItemForm({ row, onClose, onDone }) {
  const [f, setF] = useState(row || { name: '', unit: '', description: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { await api('saveItem', f); onDone(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={row ? 'Edit item' : 'Add item'} onClose={onClose}>
      <div className="grid2">
        <div><label>Item name</label><input value={f.name} onChange={set('name')} /></div>
        <div>
          <label>Unit of measure</label>
          <input list="units" value={f.unit} onChange={set('unit')} />
          <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
      </div>
      <label>Description</label>
      <textarea rows="3" placeholder="Brief description, e.g. Tororo cement 50kg CEM2" value={f.description} onChange={set('description')} />
      {err && <div className="error">{err}</div>}
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

function Items() {
  const [rows, load] = useLoad(() => api('listItems'));
  const [form, setForm] = useState(null);
  const del = async (r) => {
    if (confirm(`Delete "${r.name}"? Any stock entries for it will be deleted too.`)) { await api('deleteItem', { id: r.id }); load(); }
  };
  return (
    <>
      <PageHeader title="Items" action={<button className="btn primary" onClick={() => setForm({})}>Add Item</button>} />
      <Card title="Item list" right={`${(rows || []).length} items`}>
        <table>
          <thead><tr><th>Item name</th><th>Unit of measure</th><th>Description</th><th>Actions</th></tr></thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td className="strong">{r.name}</td>
                <td>{r.unit}</td>
                <td className="muted">{r.description}</td>
                <td>
                  <button className="btn sm" onClick={() => setForm(r)}>Edit</button>{' '}
                  <button className="btn sm danger" onClick={() => del(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan="4" className="empty">No items yet. Click “Add Item”.</td></tr>}
          </tbody>
        </table>
      </Card>
      {form && <ItemForm row={form.id ? form : null} onClose={() => setForm(null)} onDone={() => { setForm(null); load(); }} />}
    </>
  );
}

/* ---------- users ---------- */
function Users({ user }) {
  const [rows, load] = useLoad(() => api('listUsers'));
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ username: '', password: '', role: 'user' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      await api('addUser', f);
      setOpen(false); setF({ username: '', password: '', role: 'user' }); setErr(''); load();
    } catch (e) { setErr(e.message); }
  };
  const del = async (u) => {
    if (confirm(`Delete user "${u.username}"?`)) {
      try { await api('deleteUser', { id: u.id }); load(); } catch (e) { alert(e.message); }
    }
  };
  return (
    <>
      <PageHeader title="Users" action={<button className="btn primary" onClick={() => setOpen(true)}>Add User</button>} />
      <Card title="System users" right={`${(rows || []).length} users`}>
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {(rows || []).map((u) => (
              <tr key={u.id}>
                <td className="strong">{u.username}</td>
                <td><span className={'chip ' + (u.role === 'admin' ? 'purple' : '')}>{u.role === 'admin' ? 'Administrator' : 'User'}</span></td>
                <td>{shortDateTime(u.created_at)}</td>
                <td>{u.id !== user.id && <button className="btn sm danger" onClick={() => del(u)}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {open && (
        <Modal title="Add user" onClose={() => setOpen(false)}>
          <label>Username</label><input value={f.username} onChange={set('username')} />
          <label>Password</label><input value={f.password} onChange={set('password')} />
          <label>Role</label>
          <select value={f.role} onChange={set('role')}>
            <option value="user">User (sees daily sales only)</option>
            <option value="admin">Administrator</option>
          </select>
          {err && <div className="error">{err}</div>}
          <div className="actions-row">
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- change password ---------- */
function ChangePassword({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState({ ok: false, text: '' });
  const save = async () => {
    try {
      await api('changePassword', { current, next });
      setMsg({ ok: true, text: 'Password changed.' });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  return (
    <Modal title="Change password" onClose={onClose}>
      <label>Current password</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label>New password</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      {msg.text && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

/* ---------- app shell ---------- */
function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('Dashboard');
  const [pw, setPw] = useState(false);

  if (!user) return <Login onLogin={(u) => { setUser(u); setPage('Dashboard'); }} />;

  const admin = user.role === 'admin';
  const nav = admin ? ['Dashboard', 'Sales', 'Stock', 'Users', 'Items'] : ['Dashboard', 'Sales'];
  const logout = async () => { await api('logout'); setUser(null); };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="logo-mark sm" />{SHOP_NAME}</div>
        <nav>
          {nav.map((n) => (
            <button key={n} className={page === n ? 'active' : ''} onClick={() => setPage(n)}>{n}</button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who"><b>{user.username}</b><span>{admin ? 'Administrator' : 'User'}</span></div>
          <button onClick={() => setPw(true)}>Change password</button>
          {admin && <button onClick={() => api('exportBackup')}>Export backup</button>}
          <button onClick={logout}>Log out</button>
        </div>
      </aside>
      <main className="content">
        {page === 'Dashboard' && <Dashboard user={user} />}
        {page === 'Sales' && <Sales user={user} />}
        {admin && page === 'Stock' && <Stock />}
        {admin && page === 'Users' && <Users user={user} />}
        {admin && page === 'Items' && <Items />}
      </main>
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
