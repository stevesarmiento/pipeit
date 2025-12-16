import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
    className?: string;
    width?: number;
    height?: number;
}

export function Logo({ className, width = 32, height = 32 }: LogoProps) {
    return (
        <Image
            src="/pipeit.svg"
            alt="Pipeit Logo"
            width={width}
            height={height}
            className={cn('object-contain', className)}
            priority
        />
    );
}
