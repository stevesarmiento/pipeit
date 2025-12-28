'use client';

import { useEffect, useRef } from 'react';

export function GeometricWaveGridBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | undefined>(undefined);
    const timeRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        function animate() {
            if (!canvas || !ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            timeRef.current += 0.02;

            const spacing = 30;
            const radius = 6;

            for (let x = spacing; x < canvas.width; x += spacing) {
                for (let y = spacing; y < canvas.height; y += spacing) {
                    // Calculate wave influence
                    const distFromCenter = Math.hypot(x - canvas.width / 2, y - canvas.height / 2);
                    const wave1 = Math.sin(distFromCenter * 0.02 + timeRef.current) * 0.5 + 0.5;
                    const wave2 = Math.sin(x * 0.01 + timeRef.current * 0.7) * 0.5 + 0.5;
                    const wave3 = Math.sin(y * 0.01 - timeRef.current * 0.5) * 0.5 + 0.5;

                    const combinedWave = (wave1 + wave2 + wave3) / 3;

                    // Dithered opacity based on wave
                    const opacity = combinedWave * 0.3;

                    // Draw circle with dithered effect
                    if (Math.random() < combinedWave) {
                        ctx.fillStyle = `rgba(60, 60, 60, ${opacity})`;
                        ctx.beginPath();
                        ctx.arc(x, y, radius, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Draw smaller center dot
                    if (opacity > 0.15) {
                        ctx.fillStyle = `rgba(60, 60, 60, ${opacity * 1.5})`;
                        ctx.beginPath();
                        ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            frameRef.current = requestAnimationFrame(animate);
        }

        animate();

        return () => {
            window.removeEventListener('resize', resize);
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        };
    }, []);

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <canvas ref={canvasRef} className="w-full h-full" />
        </div>
    );
}
