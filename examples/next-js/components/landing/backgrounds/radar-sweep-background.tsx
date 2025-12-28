'use client';

import { useEffect, useRef } from 'react';

interface Ping {
    x: number;
    y: number;
    alpha: number;
    size: number;
}

interface RingHighlight {
    ringIndex: number;
    alpha: number;
}

export function RadarSweepBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | undefined>(undefined);
    const sweepAngleRef = useRef(0);
    const pingsRef = useRef<Ping[]>([]);
    const sweepTrailRef = useRef<{ x: number; y: number; alpha: number }[]>([]);
    const ringHighlightsRef = useRef<RingHighlight[]>([]);
    const frameCountRef = useRef(0);

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

            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const maxRadius = Math.min(canvas.width, canvas.height) * 0.45;

            frameCountRef.current++;

            // CRT monitor subtle flickering - random subtle blinks
            if (Math.random() > 0.95) {
                const ringIndex = Math.floor(Math.random() * 3);
                ringHighlightsRef.current.push({ ringIndex, alpha: 0.5 + Math.random() * 0.3 });
            }

            // Update ring highlights
            ringHighlightsRef.current = ringHighlightsRef.current.filter(highlight => {
                highlight.alpha -= 0.06;
                return highlight.alpha > 0;
            });

            // Draw concentric range rings (3 rings)
            ctx.setLineDash([]);

            for (let i = 1; i <= 4; i++) {
                const radius = (maxRadius / 4) * i;

                // Check if this ring is highlighted
                const highlight = ringHighlightsRef.current.find(h => h.ringIndex === i - 1);

                if (highlight) {
                    // Subtle CRT flicker - slightly brighter, no harsh glow
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = `rgba(60, 60, 60, ${0.08 + highlight.alpha * 0.15})`;
                    ctx.lineWidth = 1;
                } else {
                    // Normal ring
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = 'rgba(60, 60, 60, 0.08)';
                    ctx.lineWidth = 1;
                }

                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.shadowBlur = 0;

            // Draw cross hairs
            ctx.strokeStyle = 'rgba(60, 60, 60, 0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(centerX - maxRadius, centerY);
            ctx.lineTo(centerX + maxRadius, centerY);
            ctx.moveTo(centerX, centerY - maxRadius);
            ctx.lineTo(centerX, centerY + maxRadius);
            ctx.stroke();

            // Update sweep angle
            sweepAngleRef.current += 0.015;
            if (sweepAngleRef.current > Math.PI * 2) {
                sweepAngleRef.current = 0;
            }

            // Draw sweep gradient
            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
            gradient.addColorStop(0, 'rgba(60, 60, 60, 0)');
            gradient.addColorStop(0.5, 'rgba(60, 60, 60, 0.08)');
            gradient.addColorStop(1, 'rgba(60, 60, 60, 0)');

            // Draw sweep gradient BEHIND the line first
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(sweepAngleRef.current);

            // Draw sweep wedge trailing behind (negative angles = behind the line)
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, maxRadius, -Math.PI / 3, 0);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // Draw narrow fill bar right behind the sweep line
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, maxRadius, -0.03, 0);
            ctx.closePath();
            ctx.fillStyle = 'rgba(60, 60, 60, 0.15)';
            ctx.fill();

            ctx.restore();

            // Draw sweep line with gradient
            const sweepX = centerX + Math.cos(sweepAngleRef.current) * maxRadius;
            const sweepY = centerY + Math.sin(sweepAngleRef.current) * maxRadius;

            // Create line gradient from center to tip
            const lineGradient = ctx.createLinearGradient(centerX, centerY, sweepX, sweepY);
            lineGradient.addColorStop(0, 'rgba(60, 60, 60, 0.1)');
            lineGradient.addColorStop(0.7, 'rgba(60, 60, 60, 0.25)');
            lineGradient.addColorStop(1, 'rgba(60, 60, 60, 0.4)');

            ctx.strokeStyle = lineGradient;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(sweepX, sweepY);
            ctx.stroke();

            // Add current position to trail
            sweepTrailRef.current.push({ x: sweepX, y: sweepY, alpha: 1 });
            if (sweepTrailRef.current.length > 15) sweepTrailRef.current.shift();

            // Draw trail
            sweepTrailRef.current.forEach((point, idx) => {
                const alpha = (idx / sweepTrailRef.current.length) * 0.4;
                ctx.fillStyle = `rgba(60, 60, 60, ${alpha})`;
                ctx.beginPath();
                ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            });

            // Draw dot at sweep tip
            ctx.fillStyle = 'rgba(60, 60, 60, 0.5)';
            ctx.beginPath();
            ctx.arc(sweepX, sweepY, 3, 0, Math.PI * 2);
            ctx.fill();

            // Glow around tip
            ctx.shadowColor = 'rgba(60, 60, 60, 0.6)';
            ctx.shadowBlur = 6;
            ctx.fillStyle = 'rgba(60, 60, 60, 0.3)';
            ctx.beginPath();
            ctx.arc(sweepX, sweepY, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Add new pings randomly
            if (frameCountRef.current % 30 === 0 && Math.random() > 0.6) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * maxRadius * 1;
                pingsRef.current.push({
                    x: centerX + Math.cos(angle) * distance,
                    y: centerY + Math.sin(angle) * distance,
                    alpha: 1,
                    size: 3 + Math.random() * 2,
                });
            }

            // Update and draw pings
            pingsRef.current = pingsRef.current.filter(ping => {
                ping.alpha -= 0.015;

                if (ping.alpha <= 0) return false;

                // Draw ping
                ctx.fillStyle = `rgba(60, 60, 60, ${ping.alpha * 0.6})`;
                ctx.beginPath();
                ctx.arc(ping.x, ping.y, ping.size, 0, Math.PI * 2);
                ctx.fill();

                // Draw ring around ping
                ctx.strokeStyle = `rgba(60, 60, 60, ${ping.alpha * 0.3})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(ping.x, ping.y, ping.size + 2 + (1 - ping.alpha) * 4, 0, Math.PI * 2);
                ctx.stroke();

                return true;
            });

            // Draw center point
            ctx.fillStyle = 'rgba(60, 60, 60, 0.4)';
            ctx.beginPath();
            ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
            ctx.fill();

            frameRef.current = requestAnimationFrame(animate);
        }

        animate();

        return () => {
            window.removeEventListener('resize', resize);
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        };
    }, []);

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none scale-120 translate-y-[30px]">
            <canvas ref={canvasRef} className="w-full h-full" />
        </div>
    );
}
