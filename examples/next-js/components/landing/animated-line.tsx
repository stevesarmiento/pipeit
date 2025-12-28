import React from 'react';

interface AnimatedLineProps {
    id: string;
    position?: {
        left?: string;
        top?: string;
    };
    animationDelay?: string;
}

export function AnimatedLine({
    id,
    position = { left: '50%', top: '0%' },
    animationDelay = '0.5s',
}: AnimatedLineProps) {
    return (
        <svg
            className="absolute inset-0 pointer-events-none z-0"
            style={{
                left: position.left,
                top: position.top,
                transform: 'translate(-50%, -50%)',
                width: '150vw',
                height: '100vh',
            }}
        >
            <defs>
                <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="50%" stopColor="rgba(246, 245, 243, 0.8)" />
                    <stop offset="100%" stopColor="transparent" />
                </linearGradient>
            </defs>

            <line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(57, 54, 53, 1)" strokeWidth="1" />

            <rect x="0" y="50%" width="2%" height="1" fill={`url(#${id})`} transform="translate(0, -0.5)">
                <animate
                    attributeName="x"
                    values="0; 100%; 100%"
                    dur="6s"
                    begin={animationDelay}
                    repeatCount="indefinite"
                />
                <animate
                    attributeName="opacity"
                    values="0; 0.8; 0.8; 0"
                    dur="6s"
                    begin={animationDelay}
                    repeatCount="indefinite"
                />
            </rect>
        </svg>
    );
}
