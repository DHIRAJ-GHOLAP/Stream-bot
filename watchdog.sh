#!/bin/bash
# Azure Voice Bot Watchdog

cd "/home/flash/Documents/Vocice vc" || exit

echo "[Watchdog] Starting watchdog..."
termux-wake-lock

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
            pkill -f "venv/bin/python server.py"
            pkill -f "node bot.js"
            
            # Reset state
            was_disconnected=false
            
            # Start the server and bot
            source venv/bin/activate
            nohup venv/bin/python server.py > server.log 2>&1 &
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
