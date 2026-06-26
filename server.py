import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File, UploadFile, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
import shutil

app = FastAPI()

# Per-guild connected clients
# guild_id -> set(WebSocket)
listen_clients: dict[str, set] = {}      # Dashboard listeners
speak_bot_clients: dict[str, set] = {}   # Bot speak-relay receivers
metadata_clients: dict[str, set] = {}    # Dashboard metadata listeners
metadata_relay_clients: dict[str, set] = {} # Bot metadata senders

# Track which guilds/channels the bot is active in
active_guilds: dict[str, dict] = {}  # guild_id -> {guild_name, channel_name}

os.makedirs("dashboard", exist_ok=True)

@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Mount static files at /dashboard so WebSocket routes at /ws/* are not intercepted
app.mount("/dashboard", StaticFiles(directory="dashboard", html=True), name="dashboard")


@app.get("/")
async def root():
    return RedirectResponse(url="/dashboard/index.html")


@app.get("/api/guilds")
async def get_active_guilds():
    """Returns list of guilds the bot is currently active in."""
    return JSONResponse(content=active_guilds)


@app.post("/upload-bg")
async def upload_bg(file: UploadFile = File(...)):
    """Accepts an image upload and overwrites comfy_bg.png"""
    try:
        with open("comfy_bg.png", "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"status": "success", "message": "Background updated"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.post("/api/set-troll")
async def set_troll(req: Request):
    data = await req.json()
    with open("troll_target.txt", "w") as f:
        f.write(data.get("user_id", "").strip())
    return {"status": "success"}

@app.get("/api/get-troll")
async def get_troll():
    user_id = ""
    if os.path.exists("troll_target.txt"):
        with open("troll_target.txt", "r") as f:
            user_id = f.read().strip()
    return {"user_id": user_id}

@app.post("/api/set-whitelist")
async def set_whitelist(req: Request):
    data = await req.json()
    with open("whitelist.txt", "w") as f:
        f.write(data.get("ids", "").strip())
    return {"status": "success"}

@app.get("/api/get-whitelist")
async def get_whitelist():
    ids = ""
    if os.path.exists("whitelist.txt"):
        with open("whitelist.txt", "r") as f:
            ids = f.read().strip()
    return {"ids": ids}

@app.post("/api/set-volume")
async def set_volume(req: Request):
    data = await req.json()
    user_id = data.get("user_id", "").strip()
    try:
        volume = float(data.get("volume", 1.0))
    except ValueError:
        volume = 1.0
        
    if not user_id:
        return JSONResponse(status_code=400, content={"status": "error", "message": "Missing user_id"})
        
    volumes = {}
    if os.path.exists("user_volumes.json"):
        try:
            with open("user_volumes.json", "r") as f:
                volumes = json.load(f)
        except json.JSONDecodeError:
            pass
            
    volumes[user_id] = volume
    with open("user_volumes.json", "w") as f:
        json.dump(volumes, f)
        
    return {"status": "success"}

@app.get("/api/get-volumes")
async def get_volumes():
    volumes = {}
    if os.path.exists("user_volumes.json"):
        try:
            with open("user_volumes.json", "r") as f:
                volumes = json.load(f)
        except json.JSONDecodeError:
            pass
    return volumes

@app.get("/api/vc-members")
async def get_vc_members():
    members = []
    if os.path.exists("vc_members.json"):
        try:
            with open("vc_members.json", "r") as f:
                members = json.load(f)
        except json.JSONDecodeError:
            pass
    return members


# ── Register/Unregister guild ────────────────────────────────────

@app.websocket("/ws/register")
async def websocket_register(websocket: WebSocket):
    """Bot sends guild info when joining/leaving VCs."""
    await websocket.accept()
    registered_guilds: set[str] = set()
    print("Bot registration channel connected!")
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            guild_id = data.get("guild_id")
            if not guild_id:
                continue

            if action == "join":
                active_guilds[guild_id] = {
                    "guild_name": data.get("guild_name", "Unknown"),
                    "channel_name": data.get("channel_name", "Unknown"),
                }
                registered_guilds.add(guild_id)
                print(f"Guild registered: {guild_id} ({data.get('guild_name')})")
            elif action == "leave":
                active_guilds.pop(guild_id, None)
                listen_clients.pop(guild_id, None)
                speak_bot_clients.pop(guild_id, None)
                metadata_clients.pop(guild_id, None)
                metadata_relay_clients.pop(guild_id, None)
                registered_guilds.discard(guild_id)
                print(f"Guild unregistered: {guild_id}")
    except WebSocketDisconnect:
        print("Bot registration channel disconnected.")
    except Exception as e:
        print(f"Register error: {e}")
    finally:
        for guild_id in registered_guilds:
            active_guilds.pop(guild_id, None)
            listen_clients.pop(guild_id, None)
            speak_bot_clients.pop(guild_id, None)
            metadata_clients.pop(guild_id, None)
            metadata_relay_clients.pop(guild_id, None)


# ── VC Audio → Dashboard (per guild) ─────────────────────────────

@app.websocket("/ws/listen/{guild_id}")
async def websocket_listen(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    if guild_id not in listen_clients:
        listen_clients[guild_id] = set()
    listen_clients[guild_id].add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        listen_clients.get(guild_id, set()).discard(websocket)
    except Exception as e:
        print(f"Listen client error: {e}")
        listen_clients.get(guild_id, set()).discard(websocket)


@app.websocket("/ws/broadcast/{guild_id}")
async def websocket_broadcast(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    print(f"Bot broadcast connected for guild {guild_id}")
    try:
        while True:
            data = await websocket.receive_bytes()

            clients = listen_clients.get(guild_id, set())
            dead = set()
            for client in clients:
                try:
                    await client.send_bytes(data)
                except Exception:
                    dead.add(client)
            for d in dead:
                clients.discard(d)
    except WebSocketDisconnect:
        print(f"Bot broadcast disconnected for guild {guild_id}")
    except Exception as e:
        print(f"Broadcast error ({guild_id}): {e}")


# ── Dashboard Mic → VC (per guild) ───────────────────────────────

@app.websocket("/ws/speak/{guild_id}")
async def websocket_speak(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    print(f"Dashboard speaker connected for guild {guild_id}")
    try:
        while True:
            data = await websocket.receive_bytes()

            bots = speak_bot_clients.get(guild_id, set())
            dead = set()
            for bot_ws in bots:
                try:
                    await bot_ws.send_bytes(data)
                except Exception:
                    dead.add(bot_ws)
            for d in dead:
                bots.discard(d)
    except WebSocketDisconnect:
        print(f"Dashboard speaker disconnected for guild {guild_id}")
    except Exception as e:
        print(f"Speak error ({guild_id}): {e}")


@app.websocket("/ws/speak-relay/{guild_id}")
async def websocket_speak_relay(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    if guild_id not in speak_bot_clients:
        speak_bot_clients[guild_id] = set()
    speak_bot_clients[guild_id].add(websocket)
    print(f"Bot speak-relay connected for guild {guild_id}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        speak_bot_clients.get(guild_id, set()).discard(websocket)
        print(f"Bot speak-relay disconnected for guild {guild_id}")
    except Exception as e:
        speak_bot_clients.get(guild_id, set()).discard(websocket)
        print(f"Speak-relay error ({guild_id}): {e}")


# ── Dashboard Metadata ──────────────────────────────────────────────

@app.websocket("/ws/metadata/{guild_id}")
async def websocket_metadata(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    if guild_id not in metadata_clients:
        metadata_clients[guild_id] = set()
    metadata_clients[guild_id].add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        metadata_clients.get(guild_id, set()).discard(websocket)
    except Exception as e:
        print(f"Metadata client error: {e}")
        metadata_clients.get(guild_id, set()).discard(websocket)


@app.websocket("/ws/metadata-relay/{guild_id}")
async def websocket_metadata_relay(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    if guild_id not in metadata_relay_clients:
        metadata_relay_clients[guild_id] = set()
    metadata_relay_clients[guild_id].add(websocket)
    print(f"Bot metadata-relay connected for guild {guild_id}")
    try:
        while True:
            data = await websocket.receive_text()
            
            clients = metadata_clients.get(guild_id, set())
            dead = set()
            for client in clients:
                try:
                    await client.send_text(data)
                except Exception:
                    dead.add(client)
            for d in dead:
                clients.discard(d)
    except WebSocketDisconnect:
        print(f"Bot metadata-relay disconnected for guild {guild_id}")
        metadata_relay_clients.get(guild_id, set()).discard(websocket)
    except Exception as e:
        print(f"Metadata relay error ({guild_id}): {e}")
        metadata_relay_clients.get(guild_id, set()).discard(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8001")))