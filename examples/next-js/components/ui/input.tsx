import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithRef<'input'>>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                ref={ref}
                type={type}
                data-slot="input"
                className={cn(
                    'file:text-foreground placeholder:text-muted-foreground selection:bg-muted selection:text-foreground border-input hover:border-border-medium flex max-h-11 h-11 w-full min-w-0 rounded-[12px] border bg-muted px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
                    'focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] transition-all duration-200 ease-in-out',
                    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                    className,
                )}
                {...props}
            />
        );
    },
);

Input.displayName = 'Input';

export { Input };
