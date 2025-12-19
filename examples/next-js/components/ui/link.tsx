'use client';

import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type PrefetchImage = {
    srcset: string;
    sizes: string;
    src: string;
    alt: string;
    loading: string;
};

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function prefetchImages(href: string) {
    if (!href.startsWith('/') || href.startsWith('/order') || href === '/') {
        return [];
    }
    try {
        // Ensure the pathname is properly encoded
        const url = new URL(href, window.location.href);
        const encodedPath = url.pathname
            .split('/')
            .map(segment => encodeURIComponent(segment))
            .join('/');

        const response = await fetch(`/api/prefetch-images${encodedPath}`, {
            priority: 'low',
        });

        if (!response.ok) {
            return [];
        }

        const { images } = await response.json();
        return images as PrefetchImage[];
    } catch {
        return [];
    }
}

const seen = new Set<string>();

export const Link: typeof NextLink = (({ children, ...props }) => {
    const [images, setImages] = useState<PrefetchImage[]>([]);
    const [preloading, setPreloading] = useState<(() => void)[]>([]);
    const linkRef = useRef<HTMLAnchorElement>(null);
    const prefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (props.prefetch === false) {
            return;
        }

        const linkElement = linkRef.current;
        if (!linkElement) return;

        const observer = new IntersectionObserver(
            entries => {
                const entry = entries[0];
                if (entry.isIntersecting) {
                    // Set a timeout to trigger prefetch after 300ms
                    prefetchTimeoutRef.current = setTimeout(async () => {
                        router.prefetch(String(props.href));
                        await sleep(0); // We want the doc prefetches to happen first.
                        void prefetchImages(String(props.href)).then(images => {
                            setImages(images);
                        });
                        // Stop observing once images are prefetched
                        observer.unobserve(entry.target);
                    }, 300); // 300ms delay
                } else if (prefetchTimeoutRef.current) {
                    // If the element leaves the viewport before 300ms, cancel the prefetch
                    clearTimeout(prefetchTimeoutRef.current);
                    prefetchTimeoutRef.current = null;
                }
            },
            { rootMargin: '0px', threshold: 0.1 }, // Trigger when at least 10% is visible
        );

        observer.observe(linkElement);

        return () => {
            observer.disconnect(); // Cleanup the observer when the component unmounts
            if (prefetchTimeoutRef.current) {
                clearTimeout(prefetchTimeoutRef.current); // Clear any pending timeouts when component unmounts
            }
        };
    }, [props.href, props.prefetch, router]);

    return (
        <NextLink
            ref={linkRef}
            prefetch={false}
            onMouseEnter={() => {
                router.prefetch(String(props.href));
                if (preloading.length) return;
                const p: (() => void)[] = [];
                for (const image of images) {
                    const remove = prefetchImage(image);
                    if (remove) p.push(remove);
                }
                setPreloading(p);
            }}
            onMouseLeave={() => {
                for (const remove of preloading) {
                    remove();
                }
                setPreloading([]);
            }}
            onMouseDown={e => {
                const url = new URL(String(props.href), window.location.href);
                if (
                    url.origin === window.location.origin &&
                    e.button === 0 &&
                    !e.altKey &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.shiftKey
                ) {
                    e.preventDefault();
                    router.push(String(props.href));
                }
            }}
            {...props}
        >
            {children}
        </NextLink>
    );
}) as typeof NextLink;

function prefetchImage(image: PrefetchImage) {
    if (image.loading === 'lazy' || seen.has(image.srcset)) {
        return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.sizes = image.sizes;
    seen.add(image.srcset);
    img.srcset = image.srcset;
    img.src = image.src;
    img.alt = image.alt;
    let done = false;
    img.onload = img.onerror = () => {
        done = true;
    };
    return () => {
        if (done) return;
        img.src = img.srcset = '';
        seen.delete(image.srcset);
    };
}
