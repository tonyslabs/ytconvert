# Seguridad

Drstify está pensado para **un solo usuario**: no tiene cuentas, y quien llega a la página comparte cola, historial y ajustes.

## Cómo desplegarlo con seguridad
- Por defecto escucha solo en `127.0.0.1`. Si lo abres a tu LAN, tailnet o internet, **define `AUTH_PASSWORD`** y ponlo detrás de HTTPS (Caddy, nginx, Cloudflare Tunnel, Tailscale).
- No montes carpetas sensibles como `LIBRARY_DIR`; la app escribe ahí.
- Las funciones de dueño (biblioteca, suscripciones, Telegram, ajustes) no deben exponerse en una instancia pública: usa `DEMO_MODE=1` para una demo.
- Mantén la imagen actualizada: `yt-dlp` cambia seguido porque YouTube cambia seguido.

## Qué protege el código
- Solo acepta URLs de YouTube (lista de hosts), no hace peticiones a destinos arbitrarios.
- Comparación de contraseña en tiempo constante y bloqueo tras 10 intentos fallidos por IP.
- El contenedor corre sin root, sin capacidades extra y con límites de memoria, CPU y procesos.

## Reportar una vulnerabilidad
Usa **Security → Report a vulnerability** en GitHub (reporte privado). Por favor no abras un issue público con detalles de explotación. Respondo en unos días.
