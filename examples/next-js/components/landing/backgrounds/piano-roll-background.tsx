'use client';

import { useEffect, useRef } from 'react';

interface Note {
    lane: number;
    y: number;
    height: number;
    width: number;
    alpha: number;
}

// Bayer matrix 4x4 for ordered dithering
const BAYER_MATRIX = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
];

export function PianoRollBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | undefined>(undefined);
    const notesRef = useRef<Note[]>([]);
    const frameCountRef = useRef(0);
    const scrollOffsetRef = useRef(0);

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

        const numLanes = 5;
        const laneWidth = () => canvas.width / numLanes;
        const playheadY = () => canvas.height * 0.4;

        function addNote() {
            if (!canvas) return;

            const lane = Math.floor(Math.random() * numLanes);
            const width = 0.7 + Math.random() * 0.25;
            const height = 20 + Math.random() * 40;

            notesRef.current.push({
                lane,
                y: canvas.height + height,
                height,
                width,
                alpha: 1,
            });
        }

        function drawDitheredNote(
            ctx: CanvasRenderingContext2D,
            x: number,
            y: number,
            width: number,
            height: number,
            intensity: number,
            isHighlighted: boolean,
        ) {
            const pixelSize = 2;

            for (let py = 0; py < height; py += pixelSize) {
                for (let px = 0; px < width; px += pixelSize) {
                    const matrixX = Math.floor(px / pixelSize) % 4;
                    const matrixY = Math.floor(py / pixelSize) % 4;
                    const threshold = BAYER_MATRIX[matrixY][matrixX] / 16;

                    // Gradient from top to bottom of note
                    const gradientRatio = py / height;
                    const adjustedIntensity = intensity * (1 - gradientRatio * 0.5);

                    if (adjustedIntensity > threshold) {
                        const opacity = isHighlighted
                            ? 0.12 + (1 - gradientRatio) * 0.1
                            : 0.06 + (1 - gradientRatio) * 0.06;
                        ctx.fillStyle = `rgba(60, 60, 60, ${opacity})`;
                        ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
                    }
                }
            }

            // Top edge highlight
            if (isHighlighted) {
                ctx.fillStyle = 'rgba(60, 60, 60, 0.2)';
                ctx.fillRect(x, y, width, 2);
            }
        }

        function animate() {
            if (!canvas || !ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            frameCountRef.current++;
            scrollOffsetRef.current += 1;

            // Add notes periodically
            if (frameCountRef.current % 25 === 0) {
                addNote();
            }

            // Draw lane dividers with dithered dots
            for (let i = 1; i < numLanes; i++) {
                const x = (canvas.width / numLanes) * i;
                for (let y = 0; y < canvas.height; y += 8) {
                    const matrixY = Math.floor(y / 8) % 4;
                    if (matrixY % 2 === 0) {
                        ctx.fillStyle = 'rgba(60, 60, 60, 0.06)';
                        ctx.fillRect(x - 1, y, 2, 2);
                    }
                }
            }

            // Draw playhead line (dashed)
            ctx.strokeStyle = 'rgba(60, 60, 60, 0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, playheadY());
            ctx.lineTo(canvas.width, playheadY());
            ctx.stroke();
            ctx.setLineDash([]);

            // Fade zone at the top
            const fadeZoneHeight = canvas.height * 0.35;

            // Update and draw notes
            notesRef.current = notesRef.current.filter(note => {
                note.y -= 1.2;

                if (note.y < -note.height) {
                    return false;
                }

                // Calculate fade based on Y position (fade out near top)
                let fadeMult = 1;
                if (note.y < fadeZoneHeight) {
                    fadeMult = Math.max(0, note.y / fadeZoneHeight);
                }

                // Check if crossing playhead
                const isCrossingPlayhead = note.y < playheadY() && note.y + note.height > playheadY();

                const laneX = laneWidth() * note.lane + (laneWidth() * (1 - note.width)) / 2;
                const noteWidth = laneWidth() * note.width;

                // Draw dithered note
                const intensity = fadeMult * (isCrossingPlayhead ? 0.9 : 0.6);
                drawDitheredNote(ctx, laneX, note.y, noteWidth, note.height, intensity, isCrossingPlayhead);

                // Subtle border
                ctx.strokeStyle = `rgba(60, 60, 60, ${fadeMult * 0.08})`;
                ctx.lineWidth = 0.5;
                ctx.strokeRect(laneX, note.y, noteWidth, note.height);

                return true;
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
