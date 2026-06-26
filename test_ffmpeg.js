const { createCanvas } = require('canvas');
const { spawn } = require('child_process');
const fs = require('fs');

const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext('2d');

const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'bgra', // OR argb depending on endianness
    '-video_size', '1280x720',
    '-framerate', '15',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-frames:v', '15', // encode 1 second
    'output_test.mp4'
]);

ffmpeg.stderr.on('data', d => console.log(d.toString()));

let count = 0;
const interval = setInterval(() => {
    ctx.fillStyle = count % 2 === 0 ? 'red' : 'blue';
    ctx.fillRect(0, 0, 1280, 720);
    
    ctx.fillStyle = 'white';
    ctx.font = '50px Arial';
    ctx.fillText('Frame ' + count, 100, 100);

    const buf = canvas.toBuffer('raw');
    ffmpeg.stdin.write(buf);
    
    count++;
    if (count >= 15) {
        clearInterval(interval);
        ffmpeg.stdin.end();
    }
}, 1000/15);
