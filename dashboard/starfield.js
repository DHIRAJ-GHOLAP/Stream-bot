// ── Starfield Animation ─────────────────────────────────────────
const canvas = document.getElementById('starfield');
if (canvas) {
    const ctx = canvas.getContext('2d');
    let stars = [];
    const numStars = 200;

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function initStars() {
        stars = [];
        for (let i = 0; i < numStars; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                radius: Math.random() * 1.5,
                speed: Math.random() * 0.5 + 0.1,
                alpha: Math.random()
            });
        }
    }

    function animateStars() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < numStars; i++) {
            const star = stars[i];
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
            ctx.fill();

            star.y -= star.speed;
            if (star.y < 0) {
                star.y = canvas.height;
                star.x = Math.random() * canvas.width;
            }
            
            star.alpha += (Math.random() - 0.5) * 0.05;
            if (star.alpha > 1) star.alpha = 1;
            if (star.alpha < 0.2) star.alpha = 0.2;
        }
        requestAnimationFrame(animateStars);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    initStars();
    animateStars();
}
