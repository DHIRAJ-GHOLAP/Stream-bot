#!/data/data/com.termux/files/usr/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

mkdir -p ~/.cloudflared
if [ -f "103373bc-33eb-4b5a-bf12-7511b4ef9566.json" ]; then
    cp -f 103373bc-33eb-4b5a-bf12-7511b4ef9566.json ~/.cloudflared/ 2>/dev/null || true
fi

echo "Stopping existing cloudflared tunnels..."
pkill cloudflared 2>/dev/null || true

echo "Starting NAS Server & Terminal Services..."
pkill filebrowser 2>/dev/null || true
nohup filebrowser -a 127.0.0.1 -p 8080 -r /sdcard > fb.log 2>&1 &

pkill ttyd 2>/dev/null || true
nohup ttyd -W -t fontSize=18 -t disableLeaveAlert=true -c admin:admin123 -p 7681 tmux new -A -s termux > ttyd.log 2>&1 < /dev/null &

echo "Starting Portal Hub Server (Port 8000)..."
pkill -f "node generate_hub.js" 2>/dev/null || true
nohup node generate_hub.js > portal_server.log 2>&1 &

CF_CMD="cloudflared"
if command -v cloudflared >/dev/null 2>&1; then
    CF_CMD="cloudflared"
elif [ -f "./cloudflared" ] && ./cloudflared --version >/dev/null 2>&1; then
    CF_CMD="./cloudflared"
elif [ -f "$HOME/cloudflared" ] && "$HOME/cloudflared" --version >/dev/null 2>&1; then
    CF_CMD="$HOME/cloudflared"
else
    echo "Downloading Cloudflared binary for architecture..."
    ARCH="$(uname -m)"
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o ./cloudflared
    else
        curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ./cloudflared
    fi
    chmod +x ./cloudflared
    CF_CMD="./cloudflared"
fi

CRED_FILE="103373bc-33eb-4b5a-bf12-7511b4ef9566.json"

if [ -f "cloudflared.yml" ] && grep -q "azure.gholap.xyz" cloudflared.yml; then
    echo "Starting Permanent Cloudflare Named Tunnel (azure.gholap.xyz)..."
    nohup $CF_CMD tunnel --config cloudflared.yml --credentials-file "$CRED_FILE" run > cf_named_tunnel.log 2>&1 &
else
    echo "cloudflared.yml not fully configured yet. Starting temporary fallback quick tunnels..."
    nohup $CF_CMD tunnel --url http://localhost:8001 > cf_dashboard.log 2>&1 &
    nohup $CF_CMD tunnel --url http://localhost:8080 > cf_nas.log 2>&1 &
    nohup $CF_CMD tunnel --url http://localhost:7681 > cf_webssh.log 2>&1 &
    nohup $CF_CMD tunnel --url http://localhost:8000 > cf_portal.log 2>&1 &
fi

echo "All services and tunnel initiated."
