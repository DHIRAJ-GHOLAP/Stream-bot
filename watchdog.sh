#!/bin/bash
# Azure Voice Bot Watchdog

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || cd ~/Azure-Voice-Bot || exit

echo "[Watchdog] Starting watchdog..."
termux-wake-lock 2>/dev/null || true

was_disconnected=false

while true; do
    # Sleep first to avoid aggressive spinning
    sleep 15
    
    # Check internet connection
    if ping -c 1 -W 5 8.8.8.8 >/dev/null 2>&1; then
        # Internet is up, check if bot or server is not running OR if we just reconnected
        if ! pgrep -f "bot.js" >/dev/null || ! pgrep -f "server.py" >/dev/null || [ "$was_disconnected" = true ]; then
            echo "[Watchdog] $(date): Stream dead or network just reconnected. Restarting..."
            
            # Kill any stuck python server or old node instance
            pkill -f "python server.py"
            pkill -f "node bot.js"
            
            # Pull latest updates from GitHub
            echo "[Watchdog] $(date): Pulling latest changes from GitHub..."
            git pull origin main || true
            
            # Reset state
            was_disconnected=false
            
            # Start the server and bot
            if [ -d "venv" ]; then
                source venv/bin/activate 2>/dev/null || true
                nohup python server.py > server.log 2>&1 &
            else
                nohup python3 server.py > server.log 2>&1 &
            fi
            nohup node bot.js >> bot.log 2>&1 &
            
            # Start the Web Portal & Tunnels
            bash start_portal.sh
            
            echo "[Watchdog] $(date): Restart complete."
        fi
    else
        echo "[Watchdog] $(date): Network unreachable. Waiting..."
        was_disconnected=true
    fi
done
