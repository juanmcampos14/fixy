-- Quien se anotó por WhatsApp puede sumar después un email y una clave para entrar también de la forma clásica.
-- Ese email no se verifica: por eso no se le mandan correos ni enlaces para restablecer la clave (si alguien lo
-- escribió mal, un tercero no puede quedarse con la cuenta). Los avisos siguen por WhatsApp y la clave se cambia
-- entrando con el link de WhatsApp.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT true;
