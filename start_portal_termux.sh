#!/data/data/com.termux/files/usr/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Stopping existing cloudflared tunnels..."
pkill cloudflared

echo "Starting NAS Server & Terminal Services..."
pkill filebrowser
nohup filebrowser -a 127.0.0.1 -p 8080 -r /sdcard > fb.log 2>&1 &

pkill ttyd
nohup ttyd -W -t fontSize=18 -t disableLeaveAlert=true -c admin:admin123 -p 7681 tmux new -A -s termux > ttyd.log 2>&1 < /dev/null &

echo "Starting Portal Hub Server (Port 8000)..."
pkill -f "node generate_hub.js"
nohup node generate_hub.js > portal_server.log 2>&1 &

CF_CMD="cloudflared"
if [ -f "./cloudflared" ]; then
    CF_CMD="./cloudflared"
fi

if [ -f "cloudflared.yml" ] && grep -q "azure.gholap.xyz" cloudflared.yml; then
    echo "Starting Permanent Cloudflare Named Tunnel (azure.gholap.xyz)..."
    nohup $CF_CMD tunnel --config cloudflared.yml run > cf_named_tunnel.log 2>&1 &
else
    echo "cloudflared.yml not fully configured yet. Starting temporary fallback quick tunnels..."
    nohup $CF_CMD tunnel --url http://localhost:8001 > cf_dashboard.log 2>&1 &
    nohup $CF_CMD tunnel --url http://localhost:8080 > cf_nas.log 2>&1 &
    nohup $CF_CMD tunnel --url http://localhost:7681 > cf_webssh.log 2>&1 &
    nohup $CF_CMD tunnel --url http://localhost:8000 > cf_portal.log 2>&1 &
fi

echo "All services and tunnel initiated."
