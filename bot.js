require('dotenv').config({ quiet: true });
const { Client, Events, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    EndBehaviorType,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    NoSubscriberBehavior,
    entersState,
    VoiceConnectionStatus,
} = require('@discordjs/voice');
const OpusScript = require('opusscript');
const WebSocket = require('ws');
const fs = require('fs');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const cron = require('node-cron');
const { createCanvas, loadImage } = require('canvas');

const BANNED_WORDS = [
    // Profanity
    'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'slut', 'whore', 'bastard', 'motherfucker', 'cock', 'twat', 'wanker', 'prick',
    // Racist / Slurs
    'nigger', 'nigga', 'faggot', 'spic', 'chink', 'gook', 'kike', 'retard', 'tranny', 'dyke', 'beaner',
    // Religious / Highly Sensitive
    'allah', 'jesus', 'christ', 'goddamn', 'god', 'muhammad', 'yahweh', 'hindu', 'muslim', 'jew', 'christian',
    // Hindi / Local Slang
    'bhenchod', 'madarchod', 'chutiya', 'randi', 'bhosadike', 'gandu', 'lodu', 'chut', 'lund', 'bhosadi', 'bhadwe', 'maderchod', 'behenchod'
];
// Create a case-insensitive regex that matches whole words using \b boundaries
const FILTER_REGEX = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'gi');

async function sendWarning(message, text) {
    try {
        await message.delete().catch(() => {});
        const msg = await message.channel.send(`⚠️ ${message.author}, ${text}`);
        setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch (e) {
        // Ignore errors
    }
}

function censorMessage(content) {
    return content.replace(FILTER_REGEX, (match) => {
        return '*'.repeat(match.length);
    });
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8001';
const AUTO_VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const YOUTUBE_STREAM_KEY = process.env.YOUTUBE_STREAM_KEY;
const CHAT_CHANNEL_ID = process.env.CHAT_CHANNEL_ID;
const requestedRejoinInterval = Number(process.env.AUTO_REJOIN_INTERVAL_MS || 30000);
const AUTO_REJOIN_INTERVAL_MS = Number.isFinite(requestedRejoinInterval)
    ? Math.max(requestedRejoinInterval, 30000)
    : 30000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Per-guild state
const guildState = new Map();
// Each entry: { guildName, channelName, broadcastWs, speakWs, audioPlayer, passthrough, subscriptions: Map }

let registerWs = null;
let autoJoinPromise = null;
let autoRejoinTimer = null;
let autoJoinWatchdogStarted = false;
let ffmpegProcess = null;

const recentMessages = [];
const userLastMessageTime = new Map();
const recentContents = [];

const userAvatars = new Map();
const userNames = new Map();
let bgImage = null;
function loadBackground() {
    loadImage('comfy_bg.png')
        .then(img => {
            bgImage = img;
            console.log('[Canvas] Background image updated successfully.');
        })
        .catch(err => console.error('[Canvas] Failed to load background:', err.message));
}
loadBackground();

let trollTargetIds = [];
let whitelistIds = [];
let antiSpamEnabled = true;

const OWNER_IDS = ['738739339969822730', '1277655842535112747', '1315234881558806540'];

function loadTrollTarget() {
    try {
        if (fs.existsSync('troll_target.txt')) {
            const idsStr = fs.readFileSync('troll_target.txt', 'utf8').trim();
            trollTargetIds = idsStr.split(',').map(id => id.trim()).filter(id => id.length > 0);
        }
    } catch(e) {}
}

function loadWhitelist() {
    try {
        if (fs.existsSync('whitelist.txt')) {
            const idsStr = fs.readFileSync('whitelist.txt', 'utf8').trim();
            whitelistIds = idsStr.split(',').map(id => id.trim()).filter(id => id.length > 0);
        }
    } catch(e) {}
}

loadTrollTarget();
loadWhitelist();

fs.watchFile('comfy_bg.png', { interval: 2000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
        console.log('[Canvas] Background file change detected! Reloading...');
        loadBackground();
    }
});

fs.watchFile('troll_target.txt', { interval: 2000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
        console.log('[Config] troll_target.txt updated.');
        loadTrollTarget();
    }
});

fs.watchFile('whitelist.txt', { interval: 2000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
        console.log('[Config] whitelist.txt updated.');
        loadWhitelist();
    }
});

let userVolumes = new Map();
function loadUserVolumes() {
    try {
        if (fs.existsSync('user_volumes.json')) {
            const data = JSON.parse(fs.readFileSync('user_volumes.json', 'utf8'));
            userVolumes = new Map(Object.entries(data));
        }
    } catch(e) {}
}
loadUserVolumes();
fs.watchFile('user_volumes.json', { interval: 2000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
        console.log('[Config] user_volumes.json updated.');
        loadUserVolumes();
    }
});

const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext('2d');
let renderTimer = null;
let lastVideoTime = Date.now();
let pendingVideoFrames = 0;
const videoFps = 5;
const msPerFrame = 1000 / videoFps;

function startVideoRenderer() {
    if (renderTimer) clearInterval(renderTimer);
    lastVideoTime = Date.now();
    pendingVideoFrames = 0;

    renderTimer = setInterval(() => {
        if (!ffmpegProcess || !ffmpegProcess.stdin || !ffmpegProcess.stdin.writable) return;

        const now = Date.now();
        pendingVideoFrames += (now - lastVideoTime) / msPerFrame;
        lastVideoTime = now;

        if (pendingVideoFrames > 10) pendingVideoFrames = 10;

        if (pendingVideoFrames >= 1) {
            // Draw background
            if (bgImage) {
                ctx.drawImage(bgImage, 0, 0, 1280, 720);
            } else {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, 1280, 720);
            }

            // Draw speaking users
            let activeSpeakers = [];
            if (AUTO_VOICE_CHANNEL_ID) {
                const channel = client.channels.cache.get(AUTO_VOICE_CHANNEL_ID);
                if (channel) {
                    const state = guildState.get(channel.guild.id);
                    if (state) {
                        for (const [userId] of state.subscriptions) {
                            activeSpeakers.push(userId);
                        }
                    }
                }
            }

            const cardWidth = 250;
            const cardHeight = 320;
            const gap = 40;
            const totalWidth = activeSpeakers.length * cardWidth + (activeSpeakers.length - 1) * gap;
            let startX = (1280 - totalWidth) / 2;
            const startY = (720 - cardHeight) / 2;

            for (const userId of activeSpeakers) {
                ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
                ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)';
                ctx.lineWidth = 4;
                
                ctx.beginPath();
                ctx.roundRect(startX, startY, cardWidth, cardHeight, 20);
                ctx.fill();
                ctx.stroke();

                const avatar = userAvatars.get(userId);
                if (avatar) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(startX + cardWidth/2, startY + 120, 60, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.drawImage(avatar, startX + cardWidth/2 - 60, startY + 60, 120, 120);
                    ctx.restore();
                    
                    ctx.beginPath();
                    ctx.arc(startX + cardWidth/2, startY + 120, 60, 0, Math.PI * 2);
                    ctx.strokeStyle = '#4ade80';
                    ctx.lineWidth = 4;
                    ctx.stroke();
                }

                const name = userNames.get(userId) || 'User';
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 24px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(name, startX + cardWidth/2, startY + 240);

                ctx.fillStyle = '#4ade80';
                ctx.font = '18px sans-serif';
                ctx.fillText('Speaking...', startX + cardWidth/2, startY + 280);

                startX += cardWidth + gap;
            }

            // --- DRAW LIVE CHAT ---
            if (recentMessages.length > 0) {
                const nowMs = Date.now();
                // Remove messages older than 60 seconds
                while (recentMessages.length > 0 && nowMs - recentMessages[0].timestamp > 60000) {
                    recentMessages.shift();
                }

                if (recentMessages.length > 0) {
                    const chatWidth = 420;
                    const chatHeight = 220;
                    const chatX = (1280 - chatWidth) / 2;
                    const chatY = 720 - chatHeight - 15;

                    // Chat Box Background
                    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
                    ctx.beginPath();
                    ctx.roundRect(chatX, chatY, chatWidth, chatHeight, 15);
                    ctx.fill();

                    // Chat Header
                    ctx.fillStyle = '#4ade80';
                    ctx.font = 'bold 20px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.fillText('Live Chat', chatX + 20, chatY + 35);

                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(chatX + 20, chatY + 50);
                    ctx.lineTo(chatX + chatWidth - 20, chatY + 50);
                    ctx.stroke();

                    // Render Messages (Bottom Up so new messages appear at the bottom)
                    let currentTextY = chatY + chatHeight - 30;
                    
                    for (let i = recentMessages.length - 1; i >= 0; i--) {
                        if (currentTextY < chatY + 80) break; // Don't overflow top header
                        
                        const msg = recentMessages[i];
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '16px sans-serif';
                        
                        // Simple word wrap
                        const words = msg.content.split(' ');
                        const lines = [];
                        let currentLine = '';
                        
                        for (let n = 0; n < words.length; n++) {
                            const testLine = currentLine + words[n] + ' ';
                            const testWidth = ctx.measureText(testLine).width;
                            if (testWidth > chatWidth - 40 && n > 0) {
                                lines.push(currentLine);
                                currentLine = words[n] + ' ';
                            } else {
                                currentLine = testLine;
                            }
                        }
                        lines.push(currentLine);
                        
                        // Draw lines bottom up
                        for (let l = lines.length - 1; l >= 0; l--) {
                            ctx.fillText(lines[l], chatX + 20, currentTextY);
                            currentTextY -= 22;
                        }
                        
                        // Draw Username above the message
                        ctx.fillStyle = '#4ade80';
                        ctx.font = 'bold 18px sans-serif';
                        ctx.fillText(msg.username + ':', chatX + 20, currentTextY);
                        currentTextY -= 30; // Spacing for next message
                    }
                }
            }
            // -----------------------

            const buffer = canvas.toBuffer('raw');
            
            while (pendingVideoFrames >= 1) {
                if (ffmpegProcess && ffmpegProcess.stdin && ffmpegProcess.stdin.writable) {
                    ffmpegProcess.stdin.write(buffer);
                }
                pendingVideoFrames -= 1;
            }
        }
    }, msPerFrame);
}

function startYouTubeStream() {
    if (!YOUTUBE_STREAM_KEY || YOUTUBE_STREAM_KEY === 'your_youtube_rtmp_stream_key_here') {
        console.warn('[YouTube] YOUTUBE_STREAM_KEY is missing or default. Cannot start stream.');
        return;
    }
    if (ffmpegProcess) {
        console.log('[YouTube] Stream is already running.');
        return;
    }

    console.log('[YouTube] Starting FFmpeg stream...');
    const args = [
        '-f', 'rawvideo',
        '-pixel_format', 'bgra',
        '-video_size', '1280x720',
        '-framerate', '5', // Read from pipe at 5fps
        '-i', 'pipe:0',

        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-i', 'pipe:3',

        '-map', '0:v',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-threads', '4',
        '-r', '15',
        '-b:v', '1500k',
        '-minrate', '1500k',
        '-maxrate', '1500k',
        '-bufsize', '3000k',
        '-nal-hrd', 'cbr',
        '-pix_fmt', 'yuv420p',
        '-g', '30',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
        `rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}`
    ];

    ffmpegProcess = spawn('ffmpeg', args, {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe']
    });

    ffmpegProcess.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE') console.error('[YouTube] FFmpeg stdin error:', err.message);
    });
    if (ffmpegProcess.stdio[3]) {
        ffmpegProcess.stdio[3].on('error', (err) => {
            if (err.code !== 'EPIPE') console.error('[YouTube] FFmpeg stdio[3] error:', err.message);
        });
    }

    ffmpegProcess.on('close', (code) => {
        console.log(`[YouTube] FFmpeg process closed with code ${code}. Restarting in 5s...`);
        ffmpegProcess = null;
        setTimeout(() => {
            if (!ffmpegProcess) startYouTubeStream();
        }, 5000);
    });

    startVideoRenderer();

    const fs = require('fs');
    ffmpegProcess.stderr.on('data', (data) => {
        fs.appendFileSync('ffmpeg_log.txt', data.toString());
    });
}

function stopYouTubeStream() {
    if (ffmpegProcess) {
        console.log('[YouTube] Stopping FFmpeg stream...');
        if (ffmpegProcess.stdio[3]) ffmpegProcess.stdio[3].end();
        ffmpegProcess.stdin.end();
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null;
    }
    if (renderTimer) {
        clearInterval(renderTimer);
        renderTimer = null;
    }
}

function safeDestroyConnection(connection) {
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;

    try {
        connection.destroy();
    } catch (err) {
        if (!String(err.message || '').includes('already been destroyed')) {
            throw err;
        }
    }
}

// ── Registration WebSocket ──────────────────────────────────────
function connectRegisterWs() {
    registerWs = new WebSocket(`${SERVER_URL}/ws/register`);
    registerWs.on('open', () => {
        console.log('[Register] Connected.');
        for (const [guildId, state] of guildState) {
            registerGuild(guildId, state.guildName, state.channelName);
        }
    });
    registerWs.on('error', (err) => console.error('[Register] Error:', err.message));
    registerWs.on('close', () => {
        console.log('[Register] Closed. Reconnecting in 3s...');
        setTimeout(connectRegisterWs, 3000);
    });
}

function registerGuild(guildId, guildName, channelName) {
    if (registerWs && registerWs.readyState === WebSocket.OPEN) {
        registerWs.send(JSON.stringify({
            action: 'join',
            guild_id: guildId,
            guild_name: guildName,
            channel_name: channelName,
        }));
    }
}

function unregisterGuild(guildId) {
    if (registerWs && registerWs.readyState === WebSocket.OPEN) {
        registerWs.send(JSON.stringify({
            action: 'leave',
            guild_id: guildId,
        }));
    }
}

// ── Per-guild WebSocket connections ─────────────────────────────

function setupGuild(guildId, guildName, channelName, connection) {
    const state = {
        guildName,
        channelName,
        broadcastWs: null,
        speakWs: null,
        audioPlayer: null,
        passthrough: null,
        subscriptions: new Map(),
        mixQueues: new Map(),
        mixTimer: null,
        metadataWs: null,
        keepAliveTimer: null,
        lastMixTime: Date.now(),
        pendingAudioMs: 0,
    };

    // Broadcast WS (VC audio → server → dashboard)
    function connectBroadcast() {
        state.broadcastWs = new WebSocket(`${SERVER_URL}/ws/broadcast/${guildId}`);
        state.broadcastWs.on('open', () => console.log(`[${guildId}] Broadcast connected.`));
        state.broadcastWs.on('error', (err) => console.error(`[${guildId}] Broadcast error:`, err.message));
        state.broadcastWs.on('close', () => {
            if (guildState.has(guildId)) {
                console.log(`[${guildId}] Broadcast closed. Reconnecting...`);
                setTimeout(connectBroadcast, 3000);
            }
        });
    }
    connectBroadcast();

    // Speak relay WS (dashboard mic → server → bot → VC)
    function connectSpeak() {
        state.speakWs = new WebSocket(`${SERVER_URL}/ws/speak-relay/${guildId}`);
        state.speakWs.on('open', () => console.log(`[${guildId}] Speak-relay connected.`));
        state.speakWs.on('error', (err) => console.error(`[${guildId}] Speak error:`, err.message));
        state.speakWs.on('close', () => {
            if (guildState.has(guildId)) {
                console.log(`[${guildId}] Speak closed. Reconnecting...`);
                setTimeout(connectSpeak, 3000);
            }
        });
        state.speakWs.on('message', (data) => {
            if (state.passthrough && !state.passthrough.destroyed) {
                state.passthrough.write(Buffer.from(data));
            }
        });
    }
    connectSpeak();

    // Metadata relay WS (bot -> server -> dashboard)
    function connectMetadata() {
        state.metadataWs = new WebSocket(`${SERVER_URL}/ws/metadata-relay/${guildId}`);
        state.metadataWs.on('open', () => console.log(`[${guildId}] Metadata relay connected.`));
        state.metadataWs.on('error', (err) => console.error(`[${guildId}] Metadata error:`, err.message));
        state.metadataWs.on('close', () => {
            if (guildState.has(guildId)) {
                console.log(`[${guildId}] Metadata closed. Reconnecting...`);
                setTimeout(connectMetadata, 3000);
            }
        });
    }
    connectMetadata();

    // Audio player for push-to-talk
    state.audioPlayer = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    connection.subscribe(state.audioPlayer);

    state.passthrough = new PassThrough();
    const resource = createAudioResource(state.passthrough, {
        inputType: StreamType.Raw,
        inlineVolume: false,
    });
    state.audioPlayer.play(resource);

    // Keep connection alive by sending a tiny silence frame to prevent UDP socket closure
    state.keepAliveTimer = setInterval(() => {
        if (state.passthrough && !state.passthrough.destroyed) {
            state.passthrough.write(Buffer.alloc(3840)); // 20ms of silence
        }
    }, 15000);

    state.audioPlayer.on('error', (err) => {
        console.error(`[${guildId}] Player error:`, err.message);
        if (state.passthrough && !state.passthrough.destroyed) {
            state.passthrough.destroy();
        }
        state.passthrough = new PassThrough();
        const newResource = createAudioResource(state.passthrough, {
            inputType: StreamType.Raw,
            inlineVolume: false,
        });
        state.audioPlayer.play(newResource);
    });

    state.mixTimer = setInterval(() => flushMixedAudio(guildId), 20);

    guildState.set(guildId, state);
    registerGuild(guildId, guildName, channelName);

    console.log(`[${guildId}] Guild setup complete (${guildName} / #${channelName})`);
}

function attachReceiver(guildId, connection) {
    const receiver = connection.receiver;
    console.log(`[${guildId}] attachReceiver called`);
    receiver.speaking.on('start', (userId) => {
        console.log(`[${guildId}] SPEAKING START: ${userId}`);
        subscribeToUser(guildId, receiver, userId);
    });
}

function isConnectionUsable(connection) {
    return [
        VoiceConnectionStatus.Ready,
        VoiceConnectionStatus.Signalling,
        VoiceConnectionStatus.Connecting,
    ].includes(connection?.state?.status);
}

function scheduleAutoRejoin(delayMs = AUTO_REJOIN_INTERVAL_MS) {
    if (!AUTO_VOICE_CHANNEL_ID || autoRejoinTimer) return;

    autoRejoinTimer = setTimeout(() => {
        autoRejoinTimer = null;
        joinConfiguredVoiceChannel().catch((err) => {
            console.error('[AutoJoin] Rejoin failed:', err.message);
            scheduleAutoRejoin();
        });
    }, delayMs);
}

async function joinVoiceChannelByChannel(voiceChannel, { force = false } = {}) {
    const guildId = voiceChannel.guild.id;
    const existing = getVoiceConnection(guildId);

    if (!force && existing && isConnectionUsable(existing)) {
        return existing;
    }

    if (guildState.has(guildId)) {
        teardownGuild(guildId);
    }

    safeDestroyConnection(existing);

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
        } catch {
            console.log(`[${guildId}] Voice disconnected. Scheduling rejoin for #${voiceChannel.name}...`);
            teardownGuild(guildId);
            safeDestroyConnection(connection);
            scheduleAutoRejoin();
        }
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    } catch (err) {
        safeDestroyConnection(connection);
        throw err;
    }

    setupGuild(guildId, voiceChannel.guild.name, voiceChannel.name, connection);
    attachReceiver(guildId, connection);
    return connection;
}

async function joinConfiguredVoiceChannel() {
    if (!AUTO_VOICE_CHANNEL_ID) {
        console.log('[AutoJoin] VOICE_CHANNEL_ID is not set. Bot will wait for !join.');
        return null;
    }

    if (isMaintenanceWindow()) {
        console.log('[AutoJoin] Skipping join due to 5:00 AM - 5:15 AM maintenance window.');
        return null;
    }

    if (autoJoinPromise) {
        return autoJoinPromise;
    }

    autoJoinPromise = doJoinConfiguredVoiceChannel().finally(() => {
        autoJoinPromise = null;
    });

    return autoJoinPromise;
}

async function doJoinConfiguredVoiceChannel() {
    const channel = await client.channels.fetch(AUTO_VOICE_CHANNEL_ID);
    if (!channel || !channel.isVoiceBased()) {
        throw new Error(`VOICE_CHANNEL_ID ${AUTO_VOICE_CHANNEL_ID} is not a voice channel or is not accessible.`);
    }

    const guildId = channel.guild.id;
    const existing = getVoiceConnection(guildId);
    let conn = existing;
    if (!existing || !isConnectionUsable(existing)) {
        console.log(`[AutoJoin] Joining ${channel.guild.name} / #${channel.name}`);
        conn = await joinVoiceChannelByChannel(channel);
    }

    // Always ensure stream is started if we are auto-joined and not in maintenance
    if (!isMaintenanceWindow() && YOUTUBE_STREAM_KEY) {
        startYouTubeStream();
    }
    
    return conn;
}

function startAutoRejoinWatchdog() {
    if (!AUTO_VOICE_CHANNEL_ID || autoJoinWatchdogStarted) return;
    autoJoinWatchdogStarted = true;

    setInterval(() => {
        joinConfiguredVoiceChannel().catch((err) => {
            console.error('[AutoJoin] Watchdog join failed:', err.message);
        });
    }, AUTO_REJOIN_INTERVAL_MS);
}

function teardownGuild(guildId) {
    const state = guildState.get(guildId);
    if (!state) return;

    // Clean up subscriptions
    for (const [, subscription] of state.subscriptions) {
        subscription.stream.destroy();
        if (subscription.decoder) {
            try { subscription.decoder.delete(); } catch(e) {}
        }
    }
    state.subscriptions.clear();
    state.mixQueues.clear();
    if (state.mixTimer) clearInterval(state.mixTimer);
    if (state.keepAliveTimer) clearInterval(state.keepAliveTimer);

    // Clean up audio player
    if (state.audioPlayer) state.audioPlayer.stop();
    if (state.passthrough) state.passthrough.destroy();

    // Close WebSockets
    if (state.broadcastWs) state.broadcastWs.close();
    if (state.speakWs) state.speakWs.close();
    if (state.metadataWs) state.metadataWs.close();

    guildState.delete(guildId);
    unregisterGuild(guildId);

    console.log(`[${guildId}] Guild torn down.`);
}

// ── Voice Receive ───────────────────────────────────────────────

function subscribeToUser(guildId, receiver, userId) {
    const state = guildState.get(guildId);
    if (userId === client.user?.id) return;
    if (!state || state.subscriptions.has(userId)) return;

    console.log(`[${guildId}] Subscribing to user ${userId}`);
    client.users.fetch(userId).then(user => {
        userNames.set(userId, user.username);
        const url = user.displayAvatarURL({ size: 128, format: 'png', extension: 'png' });
        loadImage(url).then(img => userAvatars.set(userId, img)).catch(() => {});

        if (state.metadataWs && state.metadataWs.readyState === WebSocket.OPEN) {
            state.metadataWs.send(JSON.stringify({
                action: 'speaking_start',
                user_id: userId,
                username: user.username,
                avatar_url: url
            }));
        }
    }).catch(err => console.error(`[${guildId}] Failed to fetch user ${userId}:`, err));

    const opusStream = receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 1500,
        },
    });
    const decoder = new OpusScript(48000, 2);

    state.subscriptions.set(userId, { stream: opusStream, decoder });
    state.mixQueues.set(userId, []);
    if (!state.playingStatus) state.playingStatus = new Map();

    opusStream.on('data', (chunk) => {
        try {
            const pcm = decoder.decode(chunk);
            let pcmBuffer;
            if (pcm instanceof Int16Array) {
                pcmBuffer = Buffer.allocUnsafe(pcm.length * 2);
                for (let i = 0; i < pcm.length; i++) pcmBuffer.writeInt16LE(pcm[i], i * 2);
            } else {
                pcmBuffer = Buffer.from(pcm);
                const copy = Buffer.allocUnsafe(pcmBuffer.length);
                pcmBuffer.copy(copy);
                pcmBuffer = copy;
            }
            
            const queue = state.mixQueues.get(userId);
            if (queue) {
                queue.push(pcmBuffer);
                if (queue.length > 50) queue.shift(); // Max 1s buffer
            }
        } catch (err) {
            // Ignore decode errors like 'Invalid packet' from Discord silence padding
        }
    });

    opusStream.on('end', () => {
        console.log(`[${guildId}] Stream ended for user ${userId}`);
        state.subscriptions.delete(userId);
        state.mixQueues.delete(userId);
        if (state.playingStatus) state.playingStatus.delete(userId);
        if (state.metadataWs && state.metadataWs.readyState === WebSocket.OPEN) {
            state.metadataWs.send(JSON.stringify({ action: 'speaking_stop', user_id: userId }));
        }
        try { decoder.delete(); } catch(e) {}
    });

    opusStream.on('error', (err) => {
        console.log(`[${guildId}] Stream error for user ${userId}:`, err.message);
        state.subscriptions.delete(userId);
        state.mixQueues.delete(userId);
        if (state.playingStatus) state.playingStatus.delete(userId);
        if (state.metadataWs && state.metadataWs.readyState === WebSocket.OPEN) {
            state.metadataWs.send(JSON.stringify({ action: 'speaking_stop', user_id: userId }));
        }
        try { decoder.delete(); } catch(e) {}
    });
}

function flushMixedAudio(guildId) {
    const state = guildState.get(guildId);
    if (!state) return;

    const now = Date.now();
    state.pendingAudioMs += (now - state.lastMixTime);
    state.lastMixTime = now;

    // Cap pending audio to 1 second to prevent massive buffer dumps if event loop lags
    if (state.pendingAudioMs > 1000) state.pendingAudioMs = 1000;

    let mixedFrameForWs = null;

    // Process exactly 20ms chunks to keep FFmpeg perfectly fed
    while (state.pendingAudioMs >= 20) {
        state.pendingAudioMs -= 20;

        const frames = [];
        if (!state.playingStatus) state.playingStatus = new Map();

        for (const [userId, queue] of state.mixQueues.entries()) {
            if (queue.length > 0) {
                // Jitter buffer: wait for 4 frames (80ms) before starting to drain
                if (!state.playingStatus.get(userId) && queue.length < 4) continue;
                state.playingStatus.set(userId, true);
                
                const frame = queue.shift();
                if (frame) frames.push({ userId, buffer: frame });
            } else {
                state.playingStatus.set(userId, false);
            }
        }

        let mixed;
        if (frames.length === 0) {
            mixed = Buffer.alloc(3840);
        } else if (frames.length === 1) {
            // Apply volume if single user speaking
            const vol = userVolumes.get(frames[0].userId) ?? 1.0;
            if (vol !== 1.0) {
                mixed = Buffer.alloc(frames[0].buffer.length);
                for (let offset = 0; offset + 1 < frames[0].buffer.length; offset += 2) {
                    let sample = frames[0].buffer.readInt16LE(offset) * vol;
                    mixed.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), offset);
                }
            } else {
                mixed = frames[0].buffer;
            }
        } else {
            const byteLength = Math.max(...frames.map((frameObj) => frameObj.buffer.length));
            mixed = Buffer.alloc(byteLength);
            for (let offset = 0; offset + 1 < byteLength; offset += 2) {
                let sample = 0;
                for (const frameObj of frames) {
                    if (offset + 1 < frameObj.buffer.length) {
                        const vol = userVolumes.get(frameObj.userId) ?? 1.0;
                        sample += (frameObj.buffer.readInt16LE(offset) * vol) / frames.length;
                    }
                }
                mixed.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), offset);
            }
        }

        if (frames.length > 0) {
            let isSilent = true;
            for (let i = 0; i < mixed.length; i++) {
                if (mixed[i] !== 0) { isSilent = false; break; }
            }
            if (isSilent) {
                // Silently drop or handle all-zeroes warning if necessary
            }
        }



        if (frames.length > 0) {
            mixedFrameForWs = mixed;
        }

        if (ffmpegProcess && ffmpegProcess.stdio[3] && ffmpegProcess.stdio[3].writable) {
            ffmpegProcess.stdio[3].write(mixed);
        }
    }

    if (mixedFrameForWs && state.broadcastWs && state.broadcastWs.readyState === WebSocket.OPEN) {
        state.broadcastWs.send(mixedFrameForWs);
    }
}

// ── Bot Events ──────────────────────────────────────────────────

function isMaintenanceWindow() {
    const now = new Date();
    return now.getHours() === 5 && now.getMinutes() >= 0 && now.getMinutes() < 15;
}

// 5:00 AM Cron - Stop Stream and Leave VC
cron.schedule('0 5 * * *', () => {
    console.log('[Cron] 5:00 AM - Tearing down stream & leaving VC...');
    stopYouTubeStream();
    if (AUTO_VOICE_CHANNEL_ID) {
        client.channels.fetch(AUTO_VOICE_CHANNEL_ID).then(channel => {
            if (channel && guildState.has(channel.guild.id)) {
                teardownGuild(channel.guild.id);
                const conn = getVoiceConnection(channel.guild.id);
                if (conn) safeDestroyConnection(conn);
            }
        }).catch(console.error);
    }
});

// 5:15 AM Cron - Rejoin VC and Start Stream
cron.schedule('15 5 * * *', () => {
    console.log('[Cron] 5:15 AM - Rejoining VC & starting stream...');
    joinConfiguredVoiceChannel().catch(err => console.error('[Cron] Failed to rejoin:', err.message));
});

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
    connectRegisterWs();
    joinConfiguredVoiceChannel().catch((err) => {
        console.error('[AutoJoin] Initial join failed:', err.message);
    });
    startAutoRejoinWatchdog();
});

function updateVCMembers() {
    if (!AUTO_VOICE_CHANNEL_ID) return;
    const channel = client.channels.cache.get(AUTO_VOICE_CHANNEL_ID);
    if (channel && channel.isVoiceBased()) {
        const members = channel.members.map(m => ({
            id: m.id,
            username: m.user.username,
            avatar: m.user.displayAvatarURL({ size: 128, format: 'png', extension: 'png' }),
            bot: m.user.bot
        }));
        fs.writeFileSync('vc_members.json', JSON.stringify(members));
    }
}

client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.channelId === AUTO_VOICE_CHANNEL_ID || newState.channelId === AUTO_VOICE_CHANNEL_ID) {
        updateVCMembers();
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const userId = message.author.id;

    // --- Admin Commands for Whitelist & Troll ---
    if (message.content.startsWith('?wl') || message.content.startsWith('?troll') || message.content.startsWith('?unwl') || message.content.startsWith('?untroll') || message.content.startsWith('?antispam') || message.content.startsWith('!?sm')) {
        if (message.author.id !== message.guild.ownerId && !OWNER_IDS.includes(message.author.id)) {
            return message.reply("Only Server Owners can use this command.");
        }
        
        if (message.content.startsWith('?antispam')) {
            const args = message.content.split(' ');
            if (args[1] === 'off') {
                antiSpamEnabled = false;
                return message.reply("🛡️ Anti-Spam filters have been **DISABLED**. (Chat is now a free-for-all!)");
            } else if (args[1] === 'on') {
                antiSpamEnabled = true;
                return message.reply("🛡️ Anti-Spam filters have been **ENABLED**. (Cooldowns and filters are active.)");
            } else {
                return message.reply(`Anti-Spam is currently **${antiSpamEnabled ? 'ON' : 'OFF'}**. Use \`?antispam on\` or \`?antispam off\`.`);
            }
        }

        const mentions = message.mentions.users;
        if (mentions.size === 0) return message.reply("Please mention at least one user.");

        const mentionedIds = Array.from(mentions.keys());

        if (message.content.startsWith('?wl')) {
            mentionedIds.forEach(id => {
                if (!whitelistIds.includes(id)) whitelistIds.push(id);
            });
            fs.writeFileSync('whitelist.txt', whitelistIds.join(', '));
            return message.reply(`✅ Added ${mentionedIds.length} user(s) to the Whitelist.`);
        }
        if (message.content.startsWith('?unwl')) {
            whitelistIds = whitelistIds.filter(id => !mentionedIds.includes(id));
            fs.writeFileSync('whitelist.txt', whitelistIds.join(', '));
            return message.reply(`✅ Removed ${mentionedIds.length} user(s) from the Whitelist.`);
        }
        if (message.content.startsWith('?troll')) {
            mentionedIds.forEach(id => {
                if (!trollTargetIds.includes(id)) trollTargetIds.push(id);
            });
            fs.writeFileSync('troll_target.txt', trollTargetIds.join(', '));
            return message.reply(`😈 Added ${mentionedIds.length} user(s) to the Troll Target.`);
        }
        if (message.content.startsWith('?untroll')) {
            trollTargetIds = trollTargetIds.filter(id => !mentionedIds.includes(id));
            fs.writeFileSync('troll_target.txt', trollTargetIds.join(', '));
            return message.reply(`✅ Removed ${mentionedIds.length} user(s) from the Troll Target.`);
        }
        if (message.content.startsWith('!?sm')) {
            const args = message.content.split(' ');
            let volumePercent = 100;
            for (const arg of args) {
                if (!arg.startsWith('<@') && !arg.startsWith('!?sm')) {
                    const parsed = parseInt(arg, 10);
                    if (!isNaN(parsed)) {
                        volumePercent = parsed;
                        break;
                    }
                }
            }
            
            const volumeMultiplier = volumePercent / 100.0;
            
            let data = {};
            try {
                if (fs.existsSync('user_volumes.json')) {
                    data = JSON.parse(fs.readFileSync('user_volumes.json', 'utf8'));
                }
            } catch(e) {}
            
            mentionedIds.forEach(id => {
                data[id] = volumeMultiplier;
                userVolumes.set(id, volumeMultiplier);
            });
            fs.writeFileSync('user_volumes.json', JSON.stringify(data));
            
            return message.reply(`🔊 Stream volume for ${mentionedIds.length} user(s) set to **${volumePercent}%**.`);
        }
    }

    // --- Troll Target Logic (applies to ALL channels) ---
    if (trollTargetIds.includes(userId)) {
        await message.delete().catch(() => {});
        await message.author.send("maa mat chuda apni").catch(() => {});
        return; // Completely ignore them
    }

    if (CHAT_CHANNEL_ID && message.channel.id === CHAT_CHANNEL_ID && !message.content.startsWith('!') && !message.content.startsWith('?')) {
        const nowMs = Date.now();
        let contentToDisplay = message.content.trim();
        const lowerContent = contentToDisplay.toLowerCase();
        
        const isWhitelisted = whitelistIds.includes(userId) || OWNER_IDS.includes(userId) || !antiSpamEnabled;

        if (!isWhitelisted) {
            // Anti-Spam: Profanity Check
            FILTER_REGEX.lastIndex = 0;
            if (FILTER_REGEX.test(contentToDisplay)) {
                return sendWarning(message, "your message contains banned words and was removed.");
            }

            // Anti-Spam: 3-second cooldown per user
            const lastTime = userLastMessageTime.get(userId) || 0;
            if (nowMs - lastTime < 3000) {
                return sendWarning(message, "you are sending messages too fast! Please wait 3 seconds.");
            }
            userLastMessageTime.set(userId, nowMs);
            
            // Anti-Spam: Strong duplicate/copy-paste filter (last 20 messages)
            if (recentContents.includes(lowerContent)) {
                return sendWarning(message, "copy-pasting recent messages is not allowed!");
            }
        }
        
        recentContents.push(lowerContent);
        if (recentContents.length > 20) {
            recentContents.shift();
        }

        // Anti-Spam: Message length cap (150 chars)
        if (contentToDisplay.length > 150 && !isWhitelisted) {
            contentToDisplay = contentToDisplay.substring(0, 147) + '...';
        }

        recentMessages.push({
            username: message.author.username,
            content: contentToDisplay,
            timestamp: nowMs
        });
        if (recentMessages.length > 5) {
            recentMessages.shift();
        }
    }

    if (message.content === '!join') {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply('You must be in a voice channel first.');
        }

        const guildId = voiceChannel.guild.id;

        // If already in a VC in this guild, tear it down first
        if (guildState.has(guildId)) {
            teardownGuild(guildId);
            const existing = getVoiceConnection(guildId);
            safeDestroyConnection(existing);
        }

        try {
            await joinVoiceChannelByChannel(voiceChannel, { force: true });

            message.reply(`Joined **${voiceChannel.name}** — listening & ready for push-to-talk!`);
        } catch (err) {
            console.error('Error joining VC:', err);
            message.reply(`Error joining VC: ${err.message}`);
        }
    }

    if (message.content === '!leave') {
        const guildId = message.guild.id;
        const connection = getVoiceConnection(guildId);
        if (connection) {
            teardownGuild(guildId);
            safeDestroyConnection(connection);
            message.reply('Left the voice channel.');
        } else {
            message.reply("I'm not in a voice channel.");
        }
    }
});

function startBot() {
    if (!TOKEN || TOKEN === 'your_token_here') {
        console.error('Missing DISCORD_BOT_TOKEN. Set it in .env before starting the bot.');
        process.exit(1);
    }

    client.login(TOKEN);
}

if (require.main === module) {
    startBot();
}

module.exports = { client, startBot };
