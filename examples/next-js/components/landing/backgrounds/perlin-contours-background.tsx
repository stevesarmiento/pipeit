'use client';

import { useEffect, useRef } from 'react';

class Grad {
    x: number;
    y: number;
    z: number;
    constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    dot2(x: number, y: number): number {
        return this.x * x + this.y * y;
    }
}

class Noise {
    grad3: Grad[];
    p: number[];
    perm: number[];
    gradP: Grad[];

    constructor(seed = 0) {
        this.grad3 = [
            new Grad(1, 1, 0),
            new Grad(-1, 1, 0),
            new Grad(1, -1, 0),
            new Grad(-1, -1, 0),
            new Grad(1, 0, 1),
            new Grad(-1, 0, 1),
            new Grad(1, 0, -1),
            new Grad(-1, 0, -1),
            new Grad(0, 1, 1),
            new Grad(0, -1, 1),
            new Grad(0, 1, -1),
            new Grad(0, -1, -1),
        ];
        this.p = [
            151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37,
            240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57,
            177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77,
            146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
            65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86,
            164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85,
            212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154,
            163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178,
            185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145,
            235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4,
            150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
        ];
        this.perm = new Array(512);
        this.gradP = new Array(512);
        this.seed(seed);
    }
    seed(seed: number) {
        if (seed > 0 && seed < 1) seed *= 65536;
        seed = Math.floor(seed);
        if (seed < 256) seed |= seed << 8;
        for (let i = 0; i < 256; i++) {
            let v = i & 1 ? this.p[i] ^ (seed & 255) : this.p[i] ^ ((seed >> 8) & 255);
            this.perm[i] = this.perm[i + 256] = v;
            this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12];
        }
    }
    fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }
    lerp(a: number, b: number, t: number): number {
        return (1 - t) * a + t * b;
    }
    perlin2(x: number, y: number): number {
        let X = Math.floor(x),
            Y = Math.floor(y);
        x -= X;
        y -= Y;
        X &= 255;
        Y &= 255;
        const n00 = this.gradP[X + this.perm[Y]].dot2(x, y);
        const n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1);
        const n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y);
        const n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1);
        const u = this.fade(x);
        return this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), this.fade(y));
    }
}

export function PerlinContoursBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | undefined>(undefined);
    const noiseRef = useRef(new Noise(Math.random()));
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

            timeRef.current += 0.005;

            const contourLevels = [0.1, 0.35, 0.5, 0.65, 1];
            const scale = 0.01;

            contourLevels.forEach((level, levelIndex) => {
                const points: { x: number; y: number }[] = [];

                // March through grid to find contour lines
                for (let x = 0; x < canvas.width; x += 4) {
                    for (let y = 0; y < canvas.height; y += 4) {
                        const noiseValue = (noiseRef.current.perlin2(x * scale + timeRef.current, y * scale) + 1) / 2;

                        if (Math.abs(noiseValue - level) < 0.5) {
                            points.push({ x, y });
                        }
                    }
                }

                // Draw contour with dithered effect
                if (points.length > 0) {
                    ctx.strokeStyle = `rgba(60, 60, 60, ${0.45 + levelIndex * 0.08})`;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 4]);

                    points.forEach((point, i) => {
                        if (i === 0) {
                            ctx.beginPath();
                            ctx.moveTo(point.x, point.y);
                        } else if (i % 2 === 0) {
                            ctx.lineTo(point.x, point.y);
                        }
                    });
                    ctx.stroke();

                    // Stippled fill between levels
                    points.forEach(point => {
                        if (Math.random() > 0.7) {
                            ctx.fillStyle = `rgba(60, 60, 60, ${1 + levelIndex * 0.08})`;
                            ctx.beginPath();
                            ctx.arc(point.x, point.y, 0.8, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    });
                }
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
        <div className="absolute inset-0 overflow-hidden pointer-events-none translate-y-[-40px] mask-b-to-90% rotate-[-180deg]">
            <canvas ref={canvasRef} className="w-full h-full" />
        </div>
    );
}
