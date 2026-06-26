#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd ~/Azure-Voice-Bot
source .venv/bin/activate
nohup python server.py > server.log 2>&1 &
echo "Started server.py (PID: $!)"
nohup node bot.js > bot.log 2>&1 &
echo "Started bot.js (PID: $!)"
