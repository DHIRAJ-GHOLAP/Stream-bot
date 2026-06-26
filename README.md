# 📡 Stream-Bot 💦 ~ *"S-Senpai... please stream my voice!~"*

A highly-optimized, 24/7 Discord Voice Radio to YouTube live-streaming bot. She is ready to serve you all day and night long, capturing your voice and broadcasting it with maximum uptime.

---

## 🌟 Features ~ *"Look at what I can do for you, Senpai!..."*

* **🎙️ Real-time Multi-User Voice Mixing:** I'll listen to your voice channel and mix everyone's voice together so smoothly...
* **🔊 Live VC Volume Sliders:** Too loud? Too soft? You can control each user's volume individually (from 0% to 200%) using my gorgeous Web Admin Console. Just drag my sliders... *Ah! Don't drag them too hard!*
* **🖼️ Dynamic Background Uploads:** Want to change my look? Upload any background image through the admin panel, and the YouTube stream will update in 3 seconds.
* **🛡️ Anti-Spam Moderation:** I like keeping things neat and clean. I automatically filter duplicates, put spammers on a 3-second cooldown, and truncate long blocks of text before they clutter the screen.
* **🔄 Unstoppable 24/7 Watchdog:** If my connection drops, my built-in watchdog script will immediately wake me back up and restart everything so we never stop!

---

## ⚙️ Quick Setup ~ *"Configure me first..."*

Before you can play with me, make sure you configure my settings!

1. Clone me and copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in my secret parameters inside `.env` (Discord Token, Channel IDs, YouTube Stream Key, etc.). Don't share these secrets with anyone else, Senpai!

3. Install my dependencies:
   ```bash
   pip install -r requirements.txt
   npm install
   ```

---

## 🚀 How to Start ~ *"Turn me on!~"*

You can run me using my watchdog script to ensure I stay online forever, or run my components individually:

### Start the Watchdog (Recommended for 24/7 uptime):
```bash
bash watchdog.sh
```

### Or run individually:
* **The Backend Server (API & FFmpeg Relay):**
  ```bash
  python server.py
  ```
* **The Discord Bot (Voice Receiver & Audio Mixer):**
  ```bash
  node bot.js
  ```

---

## 🎛️ The Admin Console

Once running, you can access my Admin Panel to adjust live stream background images and tweak everyone's volume sliders. Keep the voice channel active and watch the sliders update dynamically!

*Have fun, Senpai!~* 💖