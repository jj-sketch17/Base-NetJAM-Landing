-- =============================================
-- SCRIPT DE MIGRACIÓN: Fase 2 - Admin Dashboard
-- Ejecutar en MariaDB: sudo mariadb < migrate_v2.sql
-- =============================================

USE netjam_support;

-- 1. Tabla de Entidades (como GLPI)
CREATE TABLE IF NOT EXISTS entities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Agregar columnas a usuarios
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role ENUM('admin','user') NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS entity_id INT NULL,
    ADD CONSTRAINT fk_user_entity FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;

-- 3. Agregar entity_id a tickets
ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS entity_id INT NULL,
    ADD CONSTRAINT fk_ticket_entity FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;

-- 4. Crear entidad por defecto
INSERT IGNORE INTO entities (name, description) VALUES ('NetJAM CA', 'Entidad principal');

-- 5. Promover al usuario netjam como administrador y asignarlo a la entidad
UPDATE users SET role = 'admin', entity_id = 1 WHERE username = 'netjam';
