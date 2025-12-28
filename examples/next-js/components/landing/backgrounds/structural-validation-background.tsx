'use client';

import { useEffect, useRef } from 'react';

const GRID_SIZE = 18;

const TETROMINOES = [
    { shape: [[1, 1, 1, 1]], width: 4, height: 1 }, // I
    {
        shape: [
            [1, 0, 0],
            [1, 1, 1],
        ],
        width: 3,
        height: 2,
    }, // J
    {
        shape: [
            [0, 0, 1],
            [1, 1, 1],
        ],
        width: 3,
        height: 2,
    }, // L
    {
        shape: [
            [1, 1],
            [1, 1],
        ],
        width: 2,
        height: 2,
    }, // O
    {
        shape: [
            [0, 1, 1],
            [1, 1, 0],
        ],
        width: 3,
        height: 2,
    }, // S
    {
        shape: [
            [0, 1, 0],
            [1, 1, 1],
        ],
        width: 3,
        height: 2,
    }, // T
    {
        shape: [
            [1, 1, 0],
            [0, 1, 1],
        ],
        width: 3,
        height: 2,
    }, // Z
];

interface GameState {
    board: number[][];
    currentPiece: { shape: number[][]; x: number; y: number } | null;
    cols: number;
    rows: number;
    topBuffer: number; // Hidden rows at top
    nextMoveTime: number;
    clearingRows: number[];
    clearAnimProgress: number;
    isResetting: boolean;
    resetProgress: number;
}

export function StructuralValidationBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | undefined>(undefined);
    const stateRef = useRef<GameState>({
        board: [],
        currentPiece: null,
        cols: 0,
        rows: 0,
        topBuffer: 3, // Don't draw/use top 3 rows
        nextMoveTime: 0,
        clearingRows: [],
        clearAnimProgress: 0,
        isResetting: false,
        resetProgress: 0,
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const initBoard = () => {
            const state = stateRef.current;
            state.board = [];
            for (let y = 0; y < state.rows; y++) {
                state.board[y] = new Array(state.cols).fill(0);
            }
        };

        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            const state = stateRef.current;
            state.cols = Math.floor(canvas.width / GRID_SIZE);
            // Account for the 110px offset in the parent + add buffer rows
            const visibleHeight = Math.max(canvas.height - 110, canvas.height * 0.5);
            const visibleRows = Math.floor(visibleHeight / GRID_SIZE);
            state.rows = visibleRows + state.topBuffer; // Total rows including hidden buffer
            initBoard();
            spawnPiece();
        };

        const rotateShape = (shape: number[][]): number[][] => {
            const rows = shape.length;
            const cols = shape[0].length;
            const rotated: number[][] = [];
            for (let x = 0; x < cols; x++) {
                rotated[x] = [];
                for (let y = rows - 1; y >= 0; y--) {
                    rotated[x][rows - 1 - y] = shape[y][x];
                }
            }
            return rotated;
        };

        const spawnPiece = () => {
            const state = stateRef.current;
            const type = Math.floor(Math.random() * TETROMINOES.length);
            let shape = TETROMINOES[type].shape.map(row => [...row]);

            // Random rotations
            const rotations = Math.floor(Math.random() * 4);
            for (let i = 0; i < rotations; i++) {
                shape = rotateShape(shape);
            }

            state.currentPiece = {
                shape,
                x: Math.floor(state.cols / 2) - Math.floor(shape[0].length / 2),
                y: -shape.length,
            };
        };

        const isValidPosition = (shape: number[][], px: number, py: number): boolean => {
            const state = stateRef.current;
            for (let y = 0; y < shape.length; y++) {
                for (let x = 0; x < shape[y].length; x++) {
                    if (shape[y][x]) {
                        const boardX = px + x;
                        const boardY = py + y;
                        // Check horizontal bounds
                        if (boardX < 0 || boardX >= state.cols) return false;
                        // Check bottom bound
                        if (boardY >= state.rows) return false;
                        // Check collision with existing blocks (only if on board)
                        if (boardY >= 0 && state.board[boardY][boardX]) return false;
                    }
                }
            }
            return true;
        };

        const lockPiece = () => {
            const state = stateRef.current;
            const piece = state.currentPiece;
            if (!piece) return;

            for (let y = 0; y < piece.shape.length; y++) {
                for (let x = 0; x < piece.shape[y].length; x++) {
                    if (piece.shape[y][x]) {
                        const boardY = piece.y + y;
                        const boardX = piece.x + x;
                        if (boardY >= 0 && boardY < state.rows && boardX >= 0 && boardX < state.cols) {
                            state.board[boardY][boardX] = 1;
                        }
                    }
                }
            }
            state.currentPiece = null;
        };

        const checkAndClearRows = (): number[] => {
            const state = stateRef.current;
            const fullRows: number[] = [];

            for (let y = 0; y < state.rows; y++) {
                if (state.board[y].every(cell => cell === 1)) {
                    fullRows.push(y);
                }
            }

            return fullRows;
        };

        const clearRows = (rowsToClear: number[]) => {
            const state = stateRef.current;
            // Sort rows from top to bottom for proper removal
            rowsToClear.sort((a, b) => a - b);

            // Remove rows and add empty rows at top
            for (const row of rowsToClear) {
                state.board.splice(row, 1);
                state.board.unshift(new Array(state.cols).fill(0));
            }
        };

        const checkGameOver = (): boolean => {
            const state = stateRef.current;
            // Check if any blocks are in the top buffer zone
            for (let y = 0; y < state.topBuffer; y++) {
                if (state.board[y]?.some(cell => cell === 1)) {
                    return true;
                }
            }
            return false;
        };

        const resetGame = () => {
            const state = stateRef.current;
            state.isResetting = true;
            state.resetProgress = 1;
        };

        const findBestMove = () => {
            const state = stateRef.current;
            const piece = state.currentPiece;
            if (!piece) return;

            let bestX = piece.x;
            let bestShape = piece.shape;
            let bestScore = -Infinity;

            // Try all 4 rotations
            let testShape = piece.shape;
            for (let r = 0; r < 4; r++) {
                // Try all horizontal positions
                for (let tx = -2; tx < state.cols + 2; tx++) {
                    if (isValidPosition(testShape, tx, piece.y)) {
                        // Simulate drop
                        let ty = piece.y;
                        while (isValidPosition(testShape, tx, ty + 1)) {
                            ty++;
                        }

                        // Calculate score
                        // Higher score for: lower placement, filling gaps, completing rows
                        let score = ty * 10;

                        // Check if this would complete any rows
                        const tempBoard = state.board.map(row => [...row]);
                        for (let py = 0; py < testShape.length; py++) {
                            for (let px = 0; px < testShape[py].length; px++) {
                                if (testShape[py][px]) {
                                    const by = ty + py;
                                    const bx = tx + px;
                                    if (by >= 0 && by < state.rows && bx >= 0 && bx < state.cols) {
                                        tempBoard[by][bx] = 1;
                                    }
                                }
                            }
                        }

                        // Bonus for completing rows
                        for (let y = 0; y < state.rows; y++) {
                            if (tempBoard[y].every(cell => cell === 1)) {
                                score += 100;
                            }
                        }

                        // Penalty for creating holes
                        for (let x = 0; x < state.cols; x++) {
                            let foundBlock = false;
                            for (let y = 0; y < state.rows; y++) {
                                if (tempBoard[y][x]) foundBlock = true;
                                else if (foundBlock) score -= 20; // Hole underneath a block
                            }
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestX = tx;
                            bestShape = testShape.map(row => [...row]);
                        }
                    }
                }
                testShape = rotateShape(testShape);
            }

            // Apply best move
            piece.shape = bestShape;
            if (piece.x < bestX && isValidPosition(piece.shape, piece.x + 1, piece.y)) {
                piece.x++;
            } else if (piece.x > bestX && isValidPosition(piece.shape, piece.x - 1, piece.y)) {
                piece.x--;
            }
        };

        resize();
        window.addEventListener('resize', resize);

        function animate(time: number) {
            if (!canvas || !ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const state = stateRef.current;

            // Handle reset animation (fade out everything)
            if (state.isResetting) {
                state.resetProgress -= 0.02;
                if (state.resetProgress <= 0) {
                    state.isResetting = false;
                    state.resetProgress = 0;
                    initBoard();
                    spawnPiece();
                }
            }
            // Handle row clearing animation
            else if (state.clearAnimProgress > 0) {
                state.clearAnimProgress -= 0.03;
                if (state.clearAnimProgress <= 0) {
                    clearRows(state.clearingRows);
                    state.clearingRows = [];
                    spawnPiece();
                }
            } else if (time > state.nextMoveTime) {
                state.nextMoveTime = time + 350; // Slower drop speed

                if (state.currentPiece) {
                    // AI movement
                    findBestMove();

                    // Try to move down
                    if (isValidPosition(state.currentPiece.shape, state.currentPiece.x, state.currentPiece.y + 1)) {
                        state.currentPiece.y++;
                    } else {
                        // Lock piece
                        lockPiece();

                        // Check for game over (blocks in top buffer)
                        if (checkGameOver()) {
                            resetGame();
                        } else {
                            // Check for completed rows
                            const fullRows = checkAndClearRows();
                            if (fullRows.length > 0) {
                                state.clearingRows = fullRows;
                                state.clearAnimProgress = 1;
                            } else {
                                spawnPiece();
                            }
                        }
                    }
                } else if (state.clearingRows.length === 0 && !state.isResetting) {
                    spawnPiece();
                }
            }

            // Calculate global opacity for reset fade
            const globalOpacity = state.isResetting ? state.resetProgress : 1;

            // Draw background grid dots (only below buffer)
            ctx.fillStyle = `rgba(60, 60, 60, ${0.04 * globalOpacity})`;
            for (let x = 0; x < state.cols; x++) {
                for (let y = state.topBuffer; y < state.rows; y++) {
                    const drawY = (y - state.topBuffer) * GRID_SIZE;
                    ctx.beginPath();
                    ctx.arc(x * GRID_SIZE + GRID_SIZE / 2, drawY + GRID_SIZE / 2, 1, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Draw locked blocks on board (only below buffer)
            for (let y = state.topBuffer; y < state.rows; y++) {
                for (let x = 0; x < state.cols; x++) {
                    if (state.board[y][x]) {
                        const px = x * GRID_SIZE;
                        const py = (y - state.topBuffer) * GRID_SIZE;
                        const isClearing = state.clearingRows.includes(y);
                        let opacity = isClearing ? state.clearAnimProgress * 0.4 : 0.35;
                        opacity *= globalOpacity;

                        if (isClearing) {
                            ctx.shadowColor = 'rgba(60, 60, 60, 0.6)';
                            ctx.shadowBlur = 12 * state.clearAnimProgress;
                        }

                        ctx.strokeStyle = `rgba(60, 60, 60, ${opacity})`;
                        ctx.lineWidth = 1;
                        ctx.strokeRect(px + 1.5, py + 1.5, GRID_SIZE - 3, GRID_SIZE - 3);

                        ctx.fillStyle = `rgba(60, 60, 60, ${opacity * 0.4})`;
                        ctx.fillRect(px + 3, py + 3, GRID_SIZE - 6, GRID_SIZE - 6);

                        ctx.shadowBlur = 0;
                    }
                }
            }

            // Draw current falling piece (adjusted for buffer)
            if (state.currentPiece && !state.isResetting) {
                const piece = state.currentPiece;
                for (let y = 0; y < piece.shape.length; y++) {
                    for (let x = 0; x < piece.shape[y].length; x++) {
                        if (piece.shape[y][x]) {
                            const px = (piece.x + x) * GRID_SIZE;
                            const pieceY = piece.y + y;
                            const py = (pieceY - state.topBuffer) * GRID_SIZE;

                            // Only draw if below the buffer zone
                            if (pieceY >= state.topBuffer) {
                                ctx.strokeStyle = `rgba(60, 60, 60, ${0.5 * globalOpacity})`;
                                ctx.lineWidth = 1.5;
                                ctx.strokeRect(px + 1.5, py + 1.5, GRID_SIZE - 3, GRID_SIZE - 3);

                                const pulse = Math.sin(time / 200) * 0.08 + 0.2;
                                ctx.fillStyle = `rgba(60, 60, 60, ${pulse * globalOpacity})`;
                                ctx.fillRect(px + 3, py + 3, GRID_SIZE - 6, GRID_SIZE - 6);
                            }
                        }
                    }
                }
            }

            frameRef.current = requestAnimationFrame(animate);
        }

        frameRef.current = requestAnimationFrame(animate);

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
