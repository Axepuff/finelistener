import { Box } from '@mantine/core';
import type { UiPreferenceKey } from 'electron/src/types/uiPreferences';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';

type SidebarPosition = 'left' | 'right';

interface SidebarConfig {
    node: React.ReactNode;
    minWidth: number;
    maxWidth: number;
    defaultWidth: number;
    widthPreferenceKey?: UiPreferenceKey;
    separatorAriaLabel?: string;
}

interface Props {
    content: React.ReactNode;
    // Narrowest width the content may take. Side panels shrink towards their own
    // minimum widths first, and dragging never pushes the content below this width.
    contentMinWidth?: number;
    leftSidebar?: SidebarConfig;
    rightSidebar?: SidebarConfig;
    // Legacy API for a single sidebar.
    sidebar?: React.ReactNode;
    sidebarPosition?: SidebarPosition;
    minSidebarWidth?: number;
    maxSidebarWidth?: number;
    defaultSidebarWidth?: number;
    widthPreferenceKey?: UiPreferenceKey;
    separatorAriaLabel?: string;
}

const getDeltaBySidebarPosition = (
    pointerX: number,
    resizeState: { startX: number; startWidth: number },
    sidebarPosition: SidebarPosition,
): number => {
    const rawDelta = pointerX - resizeState.startX;

    if (sidebarPosition === 'left') {
        return rawDelta;
    }

    return -rawDelta;
};

// TODO change it to react-resizable-panels lib
export const ResizableSidebarLayout: React.FC<Props> = ({
    content,
    contentMinWidth = 0,
    leftSidebar,
    rightSidebar,
    sidebar,
    sidebarPosition = 'left',
    minSidebarWidth = 320,
    maxSidebarWidth = 560,
    defaultSidebarWidth = 420,
    widthPreferenceKey,
    separatorAriaLabel = 'Resize sidebar',
}) => {
    const appStore = useAppStore();
    const layoutRef = useRef<HTMLDivElement | null>(null);
    const leftSidebarRef = useRef<HTMLDivElement | null>(null);
    const rightSidebarRef = useRef<HTMLDivElement | null>(null);
    const legacySidebarConfig = sidebar ? {
        node: sidebar,
        minWidth: minSidebarWidth,
        maxWidth: maxSidebarWidth,
        defaultWidth: defaultSidebarWidth,
        widthPreferenceKey,
        separatorAriaLabel,
    } satisfies SidebarConfig : undefined;

    const resolvedLeftSidebar = leftSidebar ?? (sidebarPosition === 'left' ? legacySidebarConfig : undefined);
    const resolvedRightSidebar = rightSidebar ?? (sidebarPosition === 'right' ? legacySidebarConfig : undefined);

    // The sidebar resized last keeps its width when space runs out; the other one shrinks first.
    const [lastResizedSidebar, setLastResizedSidebar] = useState<SidebarPosition | null>(null);
    // Set after both sidebars are created, so the handler of one can reach the other.
    const resizeEndRef = useRef<((position: SidebarPosition) => void) | null>(null);

    // Widest the dragged sidebar may become: the other sidebar can give up space down to its
    // minimum width, the content never goes below contentMinWidth.
    const getAvailableSidebarWidth = (position: SidebarPosition): number => {
        const layoutWidth = layoutRef.current?.clientWidth ?? 0;
        const otherSidebar = position === 'left' ? resolvedRightSidebar : resolvedLeftSidebar;

        if (layoutWidth === 0) return Number.POSITIVE_INFINITY;

        return layoutWidth - contentMinWidth - (otherSidebar?.minWidth ?? 0);
    };

    const useResizableSidebar = (sidebarConfig: SidebarConfig | undefined, position: SidebarPosition) => {
        const hasSidebar = sidebarConfig !== undefined;
        const minWidth = sidebarConfig?.minWidth ?? 0;
        const maxWidth = sidebarConfig?.maxWidth ?? 0;
        const defaultWidth = sidebarConfig?.defaultWidth ?? 0;
        const preferenceKey = sidebarConfig?.widthPreferenceKey;

        const clampSidebarWidth = useCallback((value: number): number => {
            if (!hasSidebar) return value;

            return Math.min(Math.max(value, minWidth), maxWidth);
        }, [hasSidebar, minWidth, maxWidth]);

        const [sidebarWidth, setSidebarWidth] = useState<number>(clampSidebarWidth(defaultWidth));
        const [isSidebarWidthLoaded, setIsSidebarWidthLoaded] = useState(false);
        const [isSidebarResizing, setIsSidebarResizing] = useState(false);
        const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

        const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
            if (!hasSidebar) return;

            event.preventDefault();
            const renderedSidebar = position === 'left' ? leftSidebarRef.current : rightSidebarRef.current;

            // Start from the rendered width: the sidebar may be narrower than its stored width
            // when the window is too narrow for it.
            resizeStateRef.current = {
                startX: event.clientX,
                startWidth: renderedSidebar?.offsetWidth || sidebarWidth,
            };
            setLastResizedSidebar(position);
            setIsSidebarResizing(true);
        }, [hasSidebar, position, sidebarWidth]);

        useEffect(() => {
            if (!hasSidebar) return;
            if (!isSidebarResizing) return;

            const handlePointerMove = (event: PointerEvent) => {
                const resizeState = resizeStateRef.current;

                if (!resizeState) return;

                const delta = getDeltaBySidebarPosition(event.clientX, resizeState, position);
                const availableWidth = Math.max(minWidth, getAvailableSidebarWidth(position));
                const nextWidth = Math.min(clampSidebarWidth(resizeState.startWidth + delta), availableWidth);

                setSidebarWidth(nextWidth);
            };

            const handlePointerUp = () => {
                setIsSidebarResizing(false);
                resizeStateRef.current = null;
                resizeEndRef.current?.(position);
            };

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);

            return () => {
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
            };
        }, [clampSidebarWidth, isSidebarResizing, minWidth, position, hasSidebar]);

        useEffect(() => {
            if (!hasSidebar) {
                setIsSidebarWidthLoaded(true);

                return;
            }

            setSidebarWidth(clampSidebarWidth(defaultWidth));
        }, [clampSidebarWidth, hasSidebar, defaultWidth]);

        useEffect(() => {
            let isActive = true;

            if (!hasSidebar) {
                setIsSidebarWidthLoaded(true);

                return () => {
                    isActive = false;
                };
            }

            setIsSidebarWidthLoaded(false);

            const loadSidebarWidthPreference = async () => {
                if (!preferenceKey || !appStore.isElectron) {
                    if (isActive) {
                        setIsSidebarWidthLoaded(true);
                    }

                    return;
                }

                try {
                    const storedSidebarWidth = await appStore.getUiPreference(preferenceKey);

                    if (!isActive) return;
                    if (typeof storedSidebarWidth !== 'number' || !Number.isFinite(storedSidebarWidth)) {
                        return;
                    }

                    setSidebarWidth(clampSidebarWidth(storedSidebarWidth));
                } catch (error) {
                    console.error('Failed to load sidebar width preference', error);
                } finally {
                    if (isActive) {
                        setIsSidebarWidthLoaded(true);
                    }
                }
            };

            void loadSidebarWidthPreference();

            return () => {
                isActive = false;
            };
        }, [clampSidebarWidth, hasSidebar, preferenceKey]);

        useEffect(() => {
            if (!hasSidebar) {
                return;
            }
            if (
                !preferenceKey
                || !isSidebarWidthLoaded
                || isSidebarResizing
                || !appStore.isElectron
            ) {
                return;
            }

            const persistSidebarWidthPreference = async () => {
                try {
                    await appStore.setUiPreference(
                        preferenceKey,
                        clampSidebarWidth(sidebarWidth),
                    );
                } catch (error) {
                    console.error('Failed to persist sidebar width preference', error);
                }
            };

            void persistSidebarWidthPreference();
        }, [
            clampSidebarWidth,
            isSidebarResizing,
            isSidebarWidthLoaded,
            hasSidebar,
            preferenceKey,
            sidebarWidth,
        ]);

        return {
            sidebarWidth,
            setSidebarWidth: (value: number) => setSidebarWidth(clampSidebarWidth(value)),
            isSidebarResizing,
            handleSidebarResizeStart,
        };
    };

    const leftSidebarState = useResizableSidebar(resolvedLeftSidebar, 'left');
    const rightSidebarState = useResizableSidebar(resolvedRightSidebar, 'right');

    // After a drag, store the width the other sidebar was squeezed to. Both saved widths then
    // fit together, so the layout comes back the same after a restart, without the
    // last-resized priority that only lives in memory.
    resizeEndRef.current = (position) => {
        const otherState = position === 'left' ? rightSidebarState : leftSidebarState;
        const otherSidebar = position === 'left' ? rightSidebarRef.current : leftSidebarRef.current;

        if (!otherSidebar) return;

        const renderedWidth = Math.floor(otherSidebar.getBoundingClientRect().width);

        if (renderedWidth < otherState.sidebarWidth) {
            otherState.setSidebarWidth(renderedWidth);
        }
    };

    const contentNode = (
        <Box style={{ minWidth: contentMinWidth, minHeight: 0, flex: 1, overflow: 'hidden' }}>
            {content}
        </Box>
    );

    const renderSidebarNode = (
        sidebarConfig: SidebarConfig | undefined,
        sidebarState: ReturnType<typeof useResizableSidebar>,
        sidebarRef: React.RefObject<HTMLDivElement | null>,
        position: SidebarPosition,
    ) => {
        if (!sidebarConfig) {
            return null;
        }

        return (
            <Box
                ref={sidebarRef}
                style={{
                    width: sidebarState.sidebarWidth,
                    minWidth: sidebarConfig.minWidth,
                    maxWidth: sidebarConfig.maxWidth,
                    minHeight: 0,
                    // Shrinks towards minWidth when the window is too narrow for the stored width.
                    // The other sidebar's large factor makes it give up nearly all the space until
                    // it reaches its own min-width; factors stay >= 1 so flexbox distributes the
                    // whole overflow once only one sidebar can still shrink.
                    flexShrink: lastResizedSidebar === null || lastResizedSidebar === position ? 1 : 1000,
                }}
            >
                {sidebarConfig.node}
            </Box>
        );
    };

    const renderSeparatorNode = (
        sidebarConfig: SidebarConfig | undefined,
        sidebarState: ReturnType<typeof useResizableSidebar>,
    ) => {
        if (!sidebarConfig) {
            return null;
        }

        return (
            <Box
                role="separator"
                aria-orientation="vertical"
                aria-label={sidebarConfig.separatorAriaLabel ?? 'Resize sidebar'}
                onPointerDown={sidebarState.handleSidebarResizeStart}
                style={{
                    width: 10,
                    cursor: 'col-resize',
                    position: 'relative',
                    flexShrink: 0,
                    userSelect: 'none',
                    margin: '0 -5px',
                }}
            >
                <Box
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: 0,
                        bottom: 0,
                        width: 1,
                        transform: 'translateX(-50%)',
                        backgroundColor: sidebarState.isSidebarResizing ?
                            'var(--brand-color-text-tertiary)' :
                            'var(--brand-color-border)',
                    }}
                />
            </Box>
        );
    };

    return (
        <Box ref={layoutRef} style={{ display: 'flex', gap: 0, minHeight: 0, flex: 1, overflow: 'hidden' }}>
            {renderSidebarNode(resolvedLeftSidebar, leftSidebarState, leftSidebarRef, 'left')}
            {renderSeparatorNode(resolvedLeftSidebar, leftSidebarState)}
            {contentNode}
            {renderSeparatorNode(resolvedRightSidebar, rightSidebarState)}
            {renderSidebarNode(resolvedRightSidebar, rightSidebarState, rightSidebarRef, 'right')}
        </Box>
    );
};
