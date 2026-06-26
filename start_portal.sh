#!/data/data/com.termux/files/usr/bin/bash

cd ~/Azure-Voice-Bot

echo "Stopping existing cloudflared tunnels..."
pkill cloudflared

echo "Starting Voice Dashboard Tunnel..."
nohup cloudflared tunnel --url http://localhost:8001 > cf_dashboard.log 2>&1 &

echo "Starting NAS Tunnel..."
nohup cloudflared tunnel --url https://localhost:8080 --no-tls-verify > cf_nas.log 2>&1 &

echo "Starting Web Terminal Service & Tunnel..."
pkill ttyd
nohup ttyd -W -t fontSize=18 -t disableLeaveAlert=true -c admin:admin123 -p 7681 tmux new -A -s termux > ttyd.log 2>&1 < /dev/null &
nohup cloudflared tunnel --url http://localhost:7681 > cf_webssh.log 2>&1 &

echo "Starting Portal Hub Server..."
pkill -f "node generate_hub.js"
nohup node generate_hub.js > portal_server.log 2>&1 &

echo "Starting Portal Hub Tunnel..."
nohup cloudflared tunnel --url http://localhost:8000 > cf_portal.log 2>&1 &

echo "All tunnels initiated. Wait a few seconds for Cloudflare to assign URLs."
