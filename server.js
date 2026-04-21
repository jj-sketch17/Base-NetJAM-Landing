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

// ===== MULTER (Subida de Archivos Segura) =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname).toLowerCase()),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error("Error: Solo se permiten imágenes, PDF o Word."));
  },
});

// ===== SECURITY UTILS =====
// Función para limpiar HTML malicioso (Anti-XSS básico)
function sanitize(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "") // Eliminar bloques de script
    .replace(/[<>]/g, (tag) => ({ "<": "&lt;", ">": "&gt;" })[tag]); // Escapar < y >
}

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
  if (!header)
    return res.status(403).send({ message: "No se proporcionó token." });
  const token = header.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(401).send({ message: "Token inválido o expirado." });
    req.user = decoded;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin")
    return res
      .status(403)
      .send({ message: "Acceso denegado. Se requiere rol admin." });
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
      [username],
    );
    if (rows.length === 0)
      return res.status(404).send({ message: "Usuario no encontrado." });
    const user = rows[0];
    const passwordIsValid = password === user.password_hash;
    if (!passwordIsValid)
      return res.status(401).send({ message: "Contraseña incorrecta." });
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        company: user.company,
        role: user.role,
        entity_id: user.entity_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: 86400 },
    );
    res
      .status(200)
      .send({
        id: user.id,
        username: user.username,
        company: user.company,
        role: user.role,
        entity_name: user.entity_name,
        accessToken: token,
      });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error en el servidor." });
  } finally {
    if (conn) conn.release();
  }
});

// 2. Crear Ticket (Usuario autenticado)
app.post(
  "/api/tickets",
  verifyToken,
  upload.single("evidence"),
  async (req, res) => {
    const { title, urgency, description } = req.body;
    const evidence_path = req.file ? req.file.path : null;
    let conn;
    try {
      conn = await pool.getConnection();
      // Sanitizar entradas
      const cleanTitle = sanitize(title);
      const cleanDesc = sanitize(description);

      await conn.query(
        "INSERT INTO tickets (user_id, entity_id, title, urgency, description, evidence_path) VALUES (?, ?, ?, ?, ?, ?)",
        [
          req.user.id,
          req.user.entity_id,
          cleanTitle,
          urgency,
          cleanDesc,
          evidence_path,
        ],
      );
      // Notificación a Telegram
      const urgencyLabels = { 1: "🟢 Baja", 2: "🟡 Media", 3: "🔴 Alta" };
      const msg = `🎫 <b>Nuevo Ticket NetJAM</b>\n👤 Usuario: <b>${req.user.username}</b>\n🏢 Empresa: ${req.user.company}\n📋 Título: ${cleanTitle}\n⚡ Urgencia: ${urgencyLabels[urgency] || urgency}\n📝 ${cleanDesc}`;
      await sendTelegramMessage(msg);
      res.status(201).send({ message: "Ticket creado exitosamente." });
    } catch (err) {
      console.error(err);
      res.status(500).send({ message: "Error al guardar el ticket." });
    } finally {
      if (conn) conn.release();
    }
  },
);

// ===========================
// ===== RUTAS DE ADMIN ======
// ===========================

// --- ENTIDADES ---
app.get("/api/admin/entities", verifyToken, verifyAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      "SELECT e.*, COUNT(u.id) as user_count FROM entities e LEFT JOIN users u ON e.id = u.entity_id GROUP BY e.id ORDER BY e.name",
    );
    res.json(rows);
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post("/api/admin/entities", verifyToken, verifyAdmin, async (req, res) => {
  const { name, description } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("INSERT INTO entities (name, description) VALUES (?, ?)", [
      sanitize(name),
      sanitize(description),
    ]);
    res.status(201).send({ message: "Entidad creada." });
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.put(
  "/api/admin/entities/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { name, description } = req.body;
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.query(
        "UPDATE entities SET name = ?, description = ? WHERE id = ?",
        [sanitize(name), sanitize(description), req.params.id],
      );
      res.send({ message: "Entidad actualizada." });
    } catch (err) {
      res.status(500).send({ message: err.message });
    } finally {
      if (conn) conn.release();
    }
  },
);

app.delete(
  "/api/admin/entities/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.query("DELETE FROM entities WHERE id = ?", [req.params.id]);
      res.send({ message: "Entidad eliminada." });
    } catch (err) {
      res.status(500).send({ message: err.message });
    } finally {
      if (conn) conn.release();
    }
  },
);

// --- USUARIOS ---
app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      "SELECT u.id, u.company, u.department, u.username, u.role, u.entity_id, u.created_at, e.name as entity_name FROM users u LEFT JOIN entities e ON u.entity_id = e.id ORDER BY u.created_at DESC",
    );
    res.json(rows);
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  const { company, department, username, password, role, entity_id } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO users (company, department, username, password_hash, role, entity_id) VALUES (?, ?, ?, ?, ?, ?)",
      [
        company,
        department,
        username,
        password,
        role || "user",
        entity_id || null,
      ],
    );
    res.status(201).send({ message: "Usuario creado." });
  } catch (err) {
    res.status(500).send({ message: err.sqlMessage || err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.put("/api/admin/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  const { company, department, role, entity_id, password } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    if (password) {
      await conn.query(
        "UPDATE users SET company=?, department=?, role=?, entity_id=?, password_hash=? WHERE id=?",
        [company, department, role, entity_id || null, password, req.params.id],
      );
    } else {
      await conn.query(
        "UPDATE users SET company=?, department=?, role=?, entity_id=? WHERE id=?",
        [company, department, role, entity_id || null, req.params.id],
      );
    }
    res.send({ message: "Usuario actualizado." });
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.delete(
  "/api/admin/users/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.query("DELETE FROM users WHERE id = ?", [req.params.id]);
      res.send({ message: "Usuario eliminado." });
    } catch (err) {
      res.status(500).send({ message: err.message });
    } finally {
      if (conn) conn.release();
    }
  },
);

// --- TICKETS ---
app.get("/api/admin/tickets", verifyToken, verifyAdmin, async (req, res) => {
  const { entity_id, status } = req.query;
  let sql = `SELECT t.*, u.username, u.company, e.name as entity_name,
             (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id AND tm.is_read = 0 AND tm.sender_role = 'user') as unread_count
             FROM tickets t 
             LEFT JOIN users u ON t.user_id = u.id 
             LEFT JOIN entities e ON t.entity_id = e.id
             WHERE 1=1`;
  const params = [];
  if (entity_id) {
    sql += " AND t.entity_id = ?";
    params.push(entity_id);
  }
  if (status) {
    sql += " AND t.status = ?";
    params.push(status);
  }
  sql += " ORDER BY t.created_at DESC";
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(sql, params);

    // Convertir BigInt de COUNT a Number para evitar el error de serialización JSON
    const tickets = rows.map((t) => ({
      ...t,
      unread_count: Number(t.unread_count || 0),
    }));

    res.json(tickets);
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.put(
  "/api/admin/tickets/:id/status",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { status } = req.body;
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.query("UPDATE tickets SET status = ? WHERE id = ?", [
        status,
        req.params.id,
      ]);
      res.send({ message: "Estado del ticket actualizado." });
    } catch (err) {
      res.status(500).send({ message: err.message });
    } finally {
      if (conn) conn.release();
    }
  },
);

// ===== MENSAJES DE TICKET (CHAT) =====

// GET mensajes de un ticket (usuario solo ve los suyos, admin ve todos)
app.get("/api/tickets/:id/messages", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    // Si no es admin, verificar que el ticket le pertenece
    if (req.user.role !== "admin") {
      const ticket = await conn.query(
        "SELECT id FROM tickets WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.id],
      );
      if (ticket.length === 0)
        return res.status(403).send({ message: "Acceso denegado." });
    }

    // Obtener descripción del ticket y nombre del usuario por separado (evita conflictos de JOIN)
    const ticketRows = await conn.query(
      "SELECT t.description, t.created_at, u.username FROM tickets t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?",
      [req.params.id],
    );

    const messages = await conn.query(
      "SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
      [req.params.id],
    );

    // Convertir el array de MariaDB a un array JS normal para poder usar unshift
    const msgsArray = Array.from(messages);

    // Inyectar la descripción original como primer mensaje virtual
    if (ticketRows.length > 0 && ticketRows[0].description) {
      const firstMsg = {
        id: "req-" + req.params.id,
        ticket_id: req.params.id,
        sender_role: "user",
        sender_name: ticketRows[0].username || "Usuario",
        message:
          "\uD83D\uDCCC REQUERIMIENTO INICIAL:\n" + ticketRows[0].description,
        is_read: 1,
        created_at: ticketRows[0].created_at,
      };
      msgsArray.unshift(firstMsg);
    }

    res.json(msgsArray);
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// PUT marcar mensajes como leídos
app.put("/api/tickets/:id/read", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    if (req.user.role === "admin") {
      await conn.query(
        "UPDATE ticket_messages SET is_read = 1 WHERE ticket_id = ? AND sender_role = 'user'",
        [req.params.id],
      );
    } else {
      await conn.query(
        "UPDATE ticket_messages SET is_read = 1 WHERE ticket_id = ? AND sender_role = 'admin'",
        [req.params.id],
      );
    }
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// POST mensaje del usuario en su ticket
app.post("/api/tickets/:id/messages", verifyToken, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim())
    return res
      .status(400)
      .send({ message: "El mensaje no puede estar vacío." });
  let conn;
  try {
    conn = await pool.getConnection();
    // Verificar que el ticket pertenece al usuario y NO esté cerrado
    const ticket = await conn.query(
      "SELECT id, status FROM tickets WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
    );
    if (ticket.length === 0)
      return res.status(403).send({ message: "Acceso denegado." });
    if (ticket[0].status === "closed")
      return res
        .status(403)
        .send({
          message: "El ticket está cerrado. No se pueden enviar más mensajes.",
        });
    await conn.query(
      "INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, message) VALUES (?, 'user', ?, ?)",
      [req.params.id, req.user.username, sanitize(message.trim())],
    );
    res.status(201).send({ message: "Mensaje enviado." });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error al enviar el mensaje." });
  } finally {
    if (conn) conn.release();
  }
});

// POST respuesta del admin en un ticket
app.post(
  "/api/admin/tickets/:id/messages",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim())
      return res
        .status(400)
        .send({ message: "El mensaje no puede estar vacío." });
    let conn;
    try {
      conn = await pool.getConnection();
      // Verificar que el ticket NO esté cerrado
      const ticket = await conn.query(
        "SELECT status FROM tickets WHERE id = ?",
        [req.params.id],
      );
      if (ticket.length > 0 && ticket[0].status === "closed") {
        return res
          .status(403)
          .send({
            message:
              "El ticket está cerrado. No se pueden enviar más respuestas.",
          });
      }
      const cleanMsg = sanitize(message.trim());
      await conn.query(
        "INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, message) VALUES (?, 'admin', ?, ?)",
        [req.params.id, req.user.username, cleanMsg],
      );
      // Notificación Telegram al responder
      const msg = `💬 <b>Respuesta en Ticket #${req.params.id}</b>\n👤 Admin: <b>${req.user.username}</b>\n📝 ${cleanMsg}`;
      await sendTelegramMessage(msg);
      res.status(201).send({ message: "Respuesta enviada." });
    } catch (err) {
      console.error(err);
      res.status(500).send({ message: "Error al procesar la respuesta." });
    } finally {
      if (conn) conn.release();
    }
  },
);

// GET tickets del usuario autenticado (para la vista de "Mis Tickets")
app.get("/api/my-tickets", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT t.*, 
      (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id AND tm.is_read = 0 AND tm.sender_role = 'admin') as unread_count 
      FROM tickets t WHERE t.user_id = ? ORDER BY t.created_at DESC`,
      [req.user.id],
    );

    // Convertir BigInt de COUNT a Number para evitar el error de serialización JSON
    const tickets = rows.map((t) => ({
      ...t,
      unread_count: Number(t.unread_count || 0),
    }));

    res.json(tickets);
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// GET global notifications count
app.get("/api/notifications", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    let count = 0;
    if (req.user.role === "admin") {
      // 1. Mensajes no leídos de usuarios
      const msgRows = await conn.query(
        "SELECT COUNT(*) as unread FROM ticket_messages WHERE is_read = 0 AND sender_role = 'user'",
      );
      const unreadMessages = Number(msgRows[0].unread);

      // 2. Tickets nuevos (abiertos y sin ninguna respuesta de admin aún)
      const ticketRows = await conn.query(`
        SELECT COUNT(*) as new_tickets 
        FROM tickets t 
        WHERE t.status = 'open' 
        AND NOT EXISTS (SELECT 1 FROM ticket_messages tm WHERE tm.ticket_id = t.id AND tm.sender_role = 'admin')
      `);
      const newTickets = Number(ticketRows[0].new_tickets);

      count = unreadMessages + newTickets;
    } else {
      const rows = await conn.query(
        "SELECT COUNT(*) as unread FROM ticket_messages tm JOIN tickets t ON tm.ticket_id = t.id WHERE tm.is_read = 0 AND tm.sender_role = 'admin' AND t.user_id = ?",
        [req.user.id],
      );
      count = Number(rows[0].unread);
    }
    res.json({ unread_count: count });
  } catch (err) {
    res.status(500).send({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Servir archivos subidos
app.use("/uploads", express.static("uploads"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🚀 Servidor NetJAM Backend corriendo en http://localhost:${PORT}`,
  );
});
