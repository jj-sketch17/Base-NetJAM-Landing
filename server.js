const express = require("express");
const mariadb = require("mariadb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// ===== DB POOL =====
const pool = mariadb.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "netjam_support",
  connectionLimit: 10,
});

// ===== MULTER (Subida de Archivos) =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ===== TELEGRAM NOTIFICATION =====
async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("Error al enviar a Telegram:", e.message);
  }
}

// ===== MIDDLEWARES =====
const verifyToken = (req, res, next) => {
  const header = req.headers["authorization"];
  if (!header) return res.status(403).send({ message: "No se proporcionó token." });
  const token = header.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: "Token inválido o expirado." });
    req.user = decoded;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).send({ message: "Acceso denegado. Se requiere rol admin." });
  next();
};

// ===========================
// ===== RUTAS PÚBLICAS ======
// ===========================

// 1. Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      "SELECT u.*, e.name as entity_name FROM users u LEFT JOIN entities e ON u.entity_id = e.id WHERE u.username = ?",
      [username]
    );
    if (rows.length === 0) return res.status(404).send({ message: "Usuario no encontrado." });
    const user = rows[0];
    const passwordIsValid = (password === user.password_hash);
    if (!passwordIsValid) return res.status(401).send({ message: "Contraseña incorrecta." });
    const token = jwt.sign(
      { id: user.id, username: user.username, company: user.company, role: user.role, entity_id: user.entity_id },
      process.env.JWT_SECRET,
      { expiresIn: 86400 }
    );
    res.status(200).send({ id: user.id, username: user.username, company: user.company, role: user.role, entity_name: user.entity_name, accessToken: token });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error en el servidor." });
  } finally {
    if (conn) conn.release();
  }
});

// 2. Crear Ticket (Usuario autenticado)
app.post("/api/tickets", verifyToken, upload.single("evidence"), async (req, res) => {
  const { title, urgency, description } = req.body;
  const evidence_path = req.file ? req.file.path : null;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO tickets (user_id, entity_id, title, urgency, description, evidence_path) VALUES (?, ?, ?, ?, ?, ?)",
      [req.user.id, req.user.entity_id, title, urgency, description, evidence_path]
    );
    // Notificación a Telegram
    const urgencyLabels = { 1: "🟢 Baja", 2: "🟡 Media", 3: "🔴 Alta" };
    const msg = `🎫 <b>Nuevo Ticket NetJAM</b>\n👤 Usuario: <b>${req.user.username}</b>\n🏢 Empresa: ${req.user.company}\n📋 Título: ${title}\n⚡ Urgencia: ${urgencyLabels[urgency] || urgency}\n📝 ${description}`;
    await sendTelegramMessage(msg);
    res.status(201).send({ message: "Ticket creado exitosamente." });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error al guardar el ticket." });
  } finally {
    if (conn) conn.release();
  }
});

// ===========================
// ===== RUTAS DE ADMIN ======
// ===========================

// --- ENTIDADES ---
app.get("/api/admin/entities", verifyToken, verifyAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query("SELECT e.*, COUNT(u.id) as user_count FROM entities e LEFT JOIN users u ON e.id = u.entity_id GROUP BY e.id ORDER BY e.name");
    res.json(rows);
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

app.post("/api/admin/entities", verifyToken, verifyAdmin, async (req, res) => {
  const { name, description } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("INSERT INTO entities (name, description) VALUES (?, ?)", [name, description]);
    res.status(201).send({ message: "Entidad creada." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

app.put("/api/admin/entities/:id", verifyToken, verifyAdmin, async (req, res) => {
  const { name, description } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("UPDATE entities SET name = ?, description = ? WHERE id = ?", [name, description, req.params.id]);
    res.send({ message: "Entidad actualizada." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

app.delete("/api/admin/entities/:id", verifyToken, verifyAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("DELETE FROM entities WHERE id = ?", [req.params.id]);
    res.send({ message: "Entidad eliminada." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

// --- USUARIOS ---
app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query("SELECT u.id, u.company, u.department, u.username, u.role, u.entity_id, u.created_at, e.name as entity_name FROM users u LEFT JOIN entities e ON u.entity_id = e.id ORDER BY u.created_at DESC");
    res.json(rows);
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

app.post("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  const { company, department, username, password, role, entity_id } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO users (company, department, username, password_hash, role, entity_id) VALUES (?, ?, ?, ?, ?, ?)",
      [company, department, username, password, role || "user", entity_id || null]
    );
    res.status(201).send({ message: "Usuario creado." });
  } catch (err) { res.status(500).send({ message: err.sqlMessage || err.message }); }
  finally { if (conn) conn.release(); }
});

app.put("/api/admin/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  const { company, department, role, entity_id, password } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    if (password) {
      await conn.query("UPDATE users SET company=?, department=?, role=?, entity_id=?, password_hash=? WHERE id=?",
        [company, department, role, entity_id || null, password, req.params.id]);
    } else {
      await conn.query("UPDATE users SET company=?, department=?, role=?, entity_id=? WHERE id=?",
        [company, department, role, entity_id || null, req.params.id]);
    }
    res.send({ message: "Usuario actualizado." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

app.delete("/api/admin/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.send({ message: "Usuario eliminado." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

// --- TICKETS ---
app.get("/api/admin/tickets", verifyToken, verifyAdmin, async (req, res) => {
  const { entity_id, status } = req.query;
  let sql = `SELECT t.*, u.username, u.company, e.name as entity_name 
             FROM tickets t 
             LEFT JOIN users u ON t.user_id = u.id 
             LEFT JOIN entities e ON t.entity_id = e.id
             WHERE 1=1`;
  const params = [];
  if (entity_id) { sql += " AND t.entity_id = ?"; params.push(entity_id); }
  if (status) { sql += " AND t.status = ?"; params.push(status); }
  sql += " ORDER BY t.created_at DESC";
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

app.put("/api/admin/tickets/:id/status", verifyToken, verifyAdmin, async (req, res) => {
  const { status } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("UPDATE tickets SET status = ? WHERE id = ?", [status, req.params.id]);
    res.send({ message: "Estado del ticket actualizado." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

// ===== MENSAJES DE TICKET (CHAT) =====

// GET mensajes de un ticket (usuario solo ve los suyos, admin ve todos)
app.get("/api/tickets/:id/messages", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    // Si no es admin, verificar que el ticket le pertenece
    if (req.user.role !== "admin") {
      const ticket = await conn.query("SELECT id FROM tickets WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
      if (ticket.length === 0) return res.status(403).send({ message: "Acceso denegado." });
    }
    const messages = await conn.query(
      "SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(messages);
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

// POST mensaje del usuario en su ticket
app.post("/api/tickets/:id/messages", verifyToken, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).send({ message: "El mensaje no puede estar vacío." });
  let conn;
  try {
    conn = await pool.getConnection();
    // Verificar que el ticket pertenece al usuario
    const ticket = await conn.query("SELECT id FROM tickets WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (ticket.length === 0) return res.status(403).send({ message: "Acceso denegado." });
    await conn.query(
      "INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, message) VALUES (?, 'user', ?, ?)",
      [req.params.id, req.user.username, message.trim()]
    );
    res.status(201).send({ message: "Mensaje enviado." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

// POST respuesta del admin en un ticket
app.post("/api/admin/tickets/:id/messages", verifyToken, verifyAdmin, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).send({ message: "El mensaje no puede estar vacío." });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, message) VALUES (?, 'admin', ?, ?)",
      [req.params.id, req.user.username, message.trim()]
    );
    // Notificación Telegram al responder
    const msg = `💬 <b>Respuesta en Ticket #${req.params.id}</b>\n👤 Admin: <b>${req.user.username}</b>\n📝 ${message.trim()}`;
    await sendTelegramMessage(msg);
    res.status(201).send({ message: "Respuesta enviada." });
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

// GET tickets del usuario autenticado (para la vista de "Mis Tickets")
app.get("/api/my-tickets", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      "SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).send({ message: err.message }); }
  finally { if (conn) conn.release(); }
});

// Servir archivos subidos
app.use("/uploads", express.static("uploads"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor NetJAM Backend corriendo en http://localhost:${PORT}`);
});
