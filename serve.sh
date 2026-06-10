#!/bin/sh
# Serve the app on all interfaces so phones on the same network can reach it.
# Usage: ./serve.sh [port]   (default: 8123)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8123}"
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null \
  || hostname -I 2>/dev/null | awk '{print $1}')
echo "Serving on:"
echo "  http://localhost:${PORT}"
[ -n "$IP" ] && echo "  http://${IP}:${PORT}  (phone on the same Wi-Fi)"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
