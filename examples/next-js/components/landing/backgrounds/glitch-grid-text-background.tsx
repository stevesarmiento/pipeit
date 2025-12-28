'use client';

import { useEffect, useRef } from 'react';

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*(){}[]<>;:,._-+=|\\/"\'`~?';

interface GridChar {
    char: string;
    glitchTimer: number;
    highlightTimer: number;
    isHighlighted: boolean;
}

export function GlitchGridTextBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | undefined>(undefined);
    const gridRef = useRef<GridChar[][]>([]);
    const frameCountRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const fontSize = 14;
        const charWidth = fontSize * 1;

        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            initGrid();
        };

        const initGrid = () => {
            const cols = Math.ceil(canvas.width / charWidth);
            const rows = Math.ceil(canvas.height / fontSize);

            gridRef.current = [];
            for (let y = 0; y < rows; y++) {
                const row: GridChar[] = [];
                for (let x = 0; x < cols; x++) {
                    row.push({
                        char: CHARS[Math.floor(Math.random() * CHARS.length)],
                        glitchTimer: Math.floor(Math.random() * 60),
                        highlightTimer: 0,
                        isHighlighted: false,
                    });
                }
                gridRef.current.push(row);
            }
        };

        resize();
        window.addEventListener('resize', resize);

        function animate() {
            if (!canvas || !ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = `${fontSize}px monospace`;

            frameCountRef.current++;

            // Random highlight trigger
            if (frameCountRef.current % 3 === 0 && Math.random() > 0.3) {
                const randomRow = Math.floor(Math.random() * gridRef.current.length);
                const randomCol = Math.floor(Math.random() * gridRef.current[0].length);

                if (gridRef.current[randomRow] && gridRef.current[randomRow][randomCol]) {
                    gridRef.current[randomRow][randomCol].isHighlighted = true;
                    gridRef.current[randomRow][randomCol].highlightTimer = 15 + Math.floor(Math.random() * 20);
                }
            }

            // Draw grid
            gridRef.current.forEach((row, rowIndex) => {
                row.forEach((cell, colIndex) => {
                    const x = colIndex * charWidth;
                    const y = rowIndex * fontSize + fontSize;

                    // Glitch timer - randomly change character
                    cell.glitchTimer--;
                    if (cell.glitchTimer <= 0) {
                        cell.char = CHARS[Math.floor(Math.random() * CHARS.length)];
                        cell.glitchTimer = 30 + Math.floor(Math.random() * 90);
                    }

                    // Handle highlight
                    if (cell.isHighlighted) {
                        cell.highlightTimer--;
                        if (cell.highlightTimer <= 0) {
                            cell.isHighlighted = false;
                        }
                    }

                    // Draw character
                    if (cell.isHighlighted) {
                        // Bright white highlight
                        const alpha = Math.min(1, cell.highlightTimer / 15);
                        ctx.fillStyle = `rgba(60, 60, 60, ${alpha * 0.9})`;

                        // Glow effect
                        ctx.shadowColor = 'rgba(60, 60, 60, 0.8)';
                        ctx.shadowBlur = 4;
                    } else {
                        // Normal glitching text
                        const opacity = 0.08 + Math.random() * 0.07;
                        ctx.fillStyle = `rgba(60, 60, 60, ${opacity})`;
                        ctx.shadowBlur = 4;
                    }

                    ctx.fillText(cell.char, x, y);

                    // Random extra glitch artifacts
                    if (Math.random() > 0.995) {
                        ctx.fillStyle = `rgba(60, 60, 60, ${0.15})`;
                        ctx.fillText(
                            CHARS[Math.floor(Math.random() * CHARS.length)],
                            x + (Math.random() - 0.5) * 3,
                            y + (Math.random() - 0.5) * 2,
                        );
                    }
                });
            });

            ctx.shadowBlur = 0;

            frameRef.current = requestAnimationFrame(animate);
        }

        animate();

        return () => {
            window.removeEventListener('resize', resize);
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        };
    }, []);

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none translate-y-[20px] mask-b-to-80%">
            <canvas ref={canvasRef} className="w-full h-full" />
        </div>
    );
}
