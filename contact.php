<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // === TRAMPA ANTI-SPAM (HONEYPOT) ===
    // Si este campo tiene algo, es un bot.
    if (!empty($_POST["website"])) {
        http_response_code(403);
        exit("Acceso denegado: Bot detectado.");
    }

    // Recibir y limpiar los datos del formulario para mayor seguridad
    $nombre = htmlspecialchars(trim($_POST["nombre"]));
    $empresa = htmlspecialchars(trim($_POST["empresa"]));
    $email = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
    $telefono = htmlspecialchars(trim($_POST["telefono"]));
    $mensaje = htmlspecialchars(trim($_POST["mensaje"]));

    // Validar campos obligatorios
    if (empty($nombre) || empty($email) || empty($telefono) || empty($mensaje) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo "<script>alert('Por favor, completa correctamente todos los campos obligatorios.'); window.history.back();</script>";
        exit;
    }

    // === CONFIGURACIÓN DEL EMAIL ===
    $destinatario = "netjam583@gmail.com"; 
    $asunto = "Nuevo Cliente Potencial - Web Net.JAM";

    // Formato del mensaje que llegará a tu correo
    $contenido_correo = "Has recibido una nueva solicitud de contacto desde tu sitio web Net.JAM.\n\n";
    $contenido_correo .= "---------------------------------------\n";
    $contenido_correo .= "DATOS DEL CLIENTE:\n";
    $contenido_correo .= "Nombre: $nombre\n";
    $contenido_correo .= "Empresa: " . ($empresa ? $empresa : "No especificada") . "\n";
    $contenido_correo .= "Email: $email\n";
    $contenido_correo .= "Teléfono: $telefono\n";
    $contenido_correo .= "---------------------------------------\n\n";
    $contenido_correo .= "MENSAJE:\n$mensaje\n";

    // Cabeceras (Headers) para asegurar que se puede responder al remitente
    // Nota: A veces los hostings requieren que el "From" sea una cuenta del propio dominio (ej: noreply@netjam.net.ve)
    // Para simplificar, usamos el email del remitente como Respond-A.
    $headers = "From: Web Net.JAM <noreply@netjam.net.ve>\r\n";
    $headers .= "Reply-To: $email\r\n";
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

    // Enviar el correo usando la función nativa de PHP de cPanel
    if (mail($destinatario, $asunto, $contenido_correo, $headers)) {
        echo "<script>alert('¡Mensaje enviado con éxito! Nos pondremos en contacto contigo pronto.'); window.location.href = 'index.html';</script>";
    } else {
        http_response_code(500);
        echo "<script>alert('Hubo un error en el servidor al enviar el mensaje. Por favor, intenta de nuevo más tarde o contáctanos por WhatsApp.'); window.history.back();</script>";
    }
} else {
    // Si alguien intenta acceder directamente al archivo .php sin enviar el formulario
    http_response_code(403);
    echo "Acceso denegado.";
}
?>
