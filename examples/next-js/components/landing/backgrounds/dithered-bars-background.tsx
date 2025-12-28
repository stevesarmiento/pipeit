'use client';

import { useEffect, useRef } from 'react';

interface Bar {
    x: number;
    targetHeight: number;
    currentHeight: number;
    speed: number;
}

export function DitheredBarsBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | undefined>(undefined);
    const barsRef = useRef<Bar[]>([]);
    const timeRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            initBars();
        };

        const initBars = () => {
            barsRef.current = [];
            const barWidth = 12;
            const numBars = Math.floor(canvas.width / (barWidth + 4));

            for (let i = 0; i < numBars; i++) {
                barsRef.current.push({
                    x: i * (barWidth + 4) + barWidth / 2,
                    targetHeight: Math.random() * canvas.height * 0.6,
                    currentHeight: 0,
                    speed: 0.05 + Math.random() * 0.05,
                });
            }
        };

        resize();
        window.addEventListener('resize', resize);

        // Bayer matrix 4x4 for dithering
        const bayerMatrix = [
            [0, 8, 2, 10],
            [12, 4, 14, 6],
            [3, 11, 1, 9],
            [15, 7, 13, 5],
        ];

        function drawDitheredBar(bar: Bar, barWidth: number) {
            if (!canvas || !ctx) return;

            const barHeight = Math.max(10, bar.currentHeight);
            const startY = canvas.height - barHeight;

            // Draw bar with Bayer matrix dithering
            for (let y = 0; y < barHeight; y += 2) {
                for (let x = 0; x < barWidth; x += 2) {
                    const matrixX = Math.floor(x / 2) % 4;
                    const matrixY = Math.floor(y / 2) % 4;
                    const threshold = bayerMatrix[matrixY][matrixX] / 16;

                    const heightRatio = y / barHeight;

                    if (heightRatio > threshold) {
                        const opacity = 0.15 + (1 - heightRatio) * 0.15;
                        ctx.fillStyle = `rgba(60, 60, 60, ${opacity})`;
                        ctx.fillRect(bar.x - barWidth / 2 + x, startY + y, 2, 2);
                    }
                }
            }

            // Top glow
            ctx.fillStyle = 'rgba(60, 60, 60, 0.3)';
            ctx.fillRect(bar.x - barWidth / 2, startY, barWidth, 2);
        }

        function animate() {
            if (!canvas || !ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            timeRef.current += 0.02;

            const barWidth = 12;

            barsRef.current.forEach((bar, i) => {
                // Update target height based on sine wave
                const wave = Math.sin(timeRef.current + i * 0.3) * 0.5 + 0.5;
                bar.targetHeight = wave * canvas.height * 0.7;

                // Smooth approach to target
                bar.currentHeight += (bar.targetHeight - bar.currentHeight) * bar.speed;

                drawDitheredBar(bar, barWidth);
            });

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
