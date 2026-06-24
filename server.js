const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'livechat_secret_key_2024';

// ─── Database (lowdb JSON) ────────────────────────────────
const fs = require('fs');
if (!fs.existsSync('./db')) fs.mkdirSync('./db');

const adapter = new FileSync('./db/data.json');
const db = low(adapter);

db.defaults({
  agents: [],
  websites: [],
  visitors: [],
  conversations: [],
  messages: []
}).write();

// Create default admin
if (!db.get('agents').find({ email: 'admin@livechat.com' }).value()) {
  db.get('agents').push({
    id: uuidv4(),
    name: 'Admin',
    email: 'admin@livechat.com',
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    created_at: new Date().toISOString()
  }).write();
  console.log('✅ Default admin: admin@livechat.com / admin123');
}

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.agent = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ─── Auth ─────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const agent = db.get('agents').find({ email }).value();
  if (!agent || !bcrypt.compareSync(password, agent.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: agent.id, name: agent.name, role: agent.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role } });
});

// ─── Websites ─────────────────────────────────────────────
app.get('/api/websites', authMiddleware, (req, res) => {
  res.json(db.get('websites').orderBy('created_at', 'desc').value());
});
app.post('/api/websites', authMiddleware, (req, res) => {
  const { name, domain } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'Name and domain required' });
  const site = { id: uuidv4(), name, domain: domain.replace(/https?:\/\//, '').replace(/\/$/, ''), api_key: uuidv4(), owner_id: req.agent.id, created_at: new Date().toISOString() };
  db.get('websites').push(site).write();
  res.json(site);
});
app.delete('/api/websites/:id', authMiddleware, (req, res) => {
  db.get('websites').remove({ id: req.params.id }).write();
  res.json({ success: true });
});

// ─── Conversations ────────────────────────────────────────
app.get('/api/conversations', authMiddleware, (req, res) => {
  const convs = db.get('conversations').orderBy('updated_at', 'desc').value();
  const result = convs.map(c => {
    const visitor = db.get('visitors').find({ id: c.visitor_id }).value() || {};
    const website = db.get('websites').find({ id: c.website_id }).value() || {};
    const agent = db.get('agents').find({ id: c.agent_id }).value() || {};
    const msgs = db.get('messages').filter({ conversation_id: c.id }).orderBy('created_at', 'desc').value();
    const lastMsg = msgs[0];
    return { ...c, visitor_name: visitor.name, page_url: visitor.page_url, is_online: visitor.is_online, visitor_email: visitor.email, website_name: website.name, agent_name: agent.name, last_message: lastMsg?.message, last_message_time: lastMsg?.created_at };
  });
  res.json(result);
});
app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  res.json(db.get('messages').filter({ conversation_id: req.params.id }).orderBy('created_at', 'asc').value());
});
app.post('/api/conversations/:id/assign', authMiddleware, (req, res) => {
  db.get('conversations').find({ id: req.params.id }).assign({ agent_id: req.agent.id }).write();
  res.json({ success: true });
});
app.post('/api/conversations/:id/close', authMiddleware, (req, res) => {
  db.get('conversations').find({ id: req.params.id }).assign({ status: 'closed' }).write();
  res.json({ success: true });
});

// ─── Visitors ─────────────────────────────────────────────
app.get('/api/visitors/online', authMiddleware, (req, res) => {
  const visitors = db.get('visitors').filter({ is_online: true }).orderBy('last_seen', 'desc').value();
  const result = visitors.map(v => {
    const website = db.get('websites').find({ id: v.website_id }).value() || {};
    return { ...v, website_name: website.name };
  });
  res.json(result);
});

// ─── Agents ───────────────────────────────────────────────
app.get('/api/agents', authMiddleware, (req, res) => {
  res.json(db.get('agents').map(a => ({ id: a.id, name: a.name, email: a.email, role: a.role, created_at: a.created_at })).value());
});
app.post('/api/agents', authMiddleware, (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (db.get('agents').find({ email }).value()) return res.status(400).json({ error: 'Email already exists' });
  const newAgent = { id: uuidv4(), name, email, password: bcrypt.hashSync(password, 10), role: 'agent', created_at: new Date().toISOString() };
  db.get('agents').push(newAgent).write();
  res.json({ id: newAgent.id, name, email, role: 'agent' });
});

// ─── Routes ───────────────────────────────────────────────
app.get('/chat.js', (req, res) => { res.setHeader('Content-Type', 'application/javascript'); res.sendFile(path.join(__dirname, 'public', 'chat-widget.js')); });
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ─── Socket.io ────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('agent:join', ({ token }) => {
    try {
      const agent = jwt.verify(token, JWT_SECRET);
      socket.agentId = agent.id; socket.agentName = agent.name;
      socket.join('agents_room');
    } catch { socket.disconnect(); }
  });

  socket.on('visitor:init', ({ apiKey, pageUrl, userAgent }) => {
    const website = db.get('websites').find({ api_key: apiKey }).value();
    if (!website) return socket.emit('error', 'Invalid API key');
    const visitorId = uuidv4();
    socket.visitorId = visitorId; socket.websiteId = website.id;
    db.get('visitors').push({ id: visitorId, website_id: website.id, name: 'Visitor', page_url: pageUrl, user_agent: userAgent, is_online: true, created_at: new Date().toISOString(), last_seen: new Date().toISOString() }).write();
    const convId = uuidv4();
    socket.conversationId = convId;
    db.get('conversations').push({ id: convId, visitor_id: visitorId, website_id: website.id, agent_id: null, status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).write();
    socket.join(`visitor_${visitorId}`);
    io.to('agents_room').emit('visitor:new', { visitorId, conversationId: convId, websiteName: website.name, pageUrl, time: new Date().toISOString() });
    socket.emit('visitor:ready', { conversationId: convId, visitorId });
  });

  socket.on('visitor:identify', ({ name, email }) => {
    if (!socket.visitorId) return;
    db.get('visitors').find({ id: socket.visitorId }).assign({ name: name || 'Visitor', email: email || null }).write();
    io.to('agents_room').emit('visitor:updated', { visitorId: socket.visitorId, name, email });
  });

  socket.on('visitor:message', ({ message }) => {
    if (!socket.conversationId || !message.trim()) return;
    const msgId = uuidv4();
    const visitor = db.get('visitors').find({ id: socket.visitorId }).value();
    db.get('messages').push({ id: msgId, conversation_id: socket.conversationId, sender_type: 'visitor', sender_id: socket.visitorId, sender_name: visitor?.name || 'Visitor', message, created_at: new Date().toISOString() }).write();
    db.get('conversations').find({ id: socket.conversationId }).assign({ updated_at: new Date().toISOString() }).write();
    const msgData = { id: msgId, conversationId: socket.conversationId, visitorId: socket.visitorId, senderType: 'visitor', senderName: visitor?.name || 'Visitor', message, time: new Date().toISOString() };
    io.to('agents_room').emit('message:new', msgData);
    socket.emit('message:sent', msgData);
  });

  socket.on('agent:message', ({ conversationId, message }) => {
    if (!socket.agentId || !message.trim()) return;
    const conv = db.get('conversations').find({ id: conversationId }).value();
    if (!conv) return;
    const msgId = uuidv4();
    db.get('messages').push({ id: msgId, conversation_id: conversationId, sender_type: 'agent', sender_id: socket.agentId, sender_name: socket.agentName, message, created_at: new Date().toISOString() }).write();
    db.get('conversations').find({ id: conversationId }).assign({ updated_at: new Date().toISOString(), agent_id: socket.agentId }).write();
    const msgData = { id: msgId, conversationId, senderType: 'agent', senderName: socket.agentName, message, time: new Date().toISOString() };
    io.to(`visitor_${conv.visitor_id}`).emit('message:new', msgData);
    io.to('agents_room').emit('message:new', msgData);
  });

  socket.on('disconnect', () => {
    if (socket.visitorId) {
      db.get('visitors').find({ id: socket.visitorId }).assign({ is_online: false, last_seen: new Date().toISOString() }).write();
      io.to('agents_room').emit('visitor:offline', { visitorId: socket.visitorId, conversationId: socket.conversationId });
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 LiveChat running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});
