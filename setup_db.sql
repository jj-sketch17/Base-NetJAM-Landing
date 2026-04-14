-- Base de datos para el portal de soporte NetJAM
CREATE DATABASE IF NOT EXISTS netjam_support;
USE netjam_support;

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de tickets
CREATE TABLE IF NOT EXISTS tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    urgency TINYINT NOT NULL CHECK (urgency BETWEEN 1 AND 3),
    description TEXT NOT NULL,
    evidence_path VARCHAR(255),
    status ENUM('open', 'pending', 'resolved', 'closed') DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Usuario de prueba (contraseña: netjam2026)
-- En un entorno real, la contraseña debe ser hasheada con bcryptjs antes de insertarse.
-- Este es solo un ejemplo para inicialización.
INSERT INTO users (company, department, username, password_hash) 
VALUES ('NetJAM CA', 'IT', 'admin', '$2a$10$7Z8L1v7FwP0G0K0K0K0K0e5.8vV7W8W8W8W8W8W8W8W8W8W8W8W8W'); 
-- Nota: El hash de arriba es un placeholder, lo generaremos correctamente en el backend.
