import { Box } from '@mantine/core';
import type { UiPreferenceKey } from 'electron/src/types/uiPreferences';
import React, { useCallback, useEffect, useRef, useState } from 'react';

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

export const ResizableSidebarLayout: React.FC<Props> = ({
    content,
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

    const useResizableSidebar = (sidebarConfig: SidebarConfig | undefined, position: SidebarPosition) => {
        const clampSidebarWidth = useCallback((value: number): number => {
            if (!sidebarConfig) return value;

            return Math.min(Math.max(value, sidebarConfig.minWidth), sidebarConfig.maxWidth);
        }, [sidebarConfig]);

        const [sidebarWidth, setSidebarWidth] = useState<number>(clampSidebarWidth(sidebarConfig?.defaultWidth ?? 0));
        const [isSidebarWidthLoaded, setIsSidebarWidthLoaded] = useState(false);
        const [isSidebarResizing, setIsSidebarResizing] = useState(false);
        const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

        const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
            if (!sidebarConfig) return;

            event.preventDefault();
            resizeStateRef.current = {
                startX: event.clientX,
                startWidth: sidebarWidth,
            };
            setIsSidebarResizing(true);
        }, [sidebarConfig, sidebarWidth]);

        useEffect(() => {
            if (!sidebarConfig) return;
            if (!isSidebarResizing) return;

            const handlePointerMove = (event: PointerEvent) => {
                const resizeState = resizeStateRef.current;

                if (!resizeState) return;

                const delta = getDeltaBySidebarPosition(event.clientX, resizeState, position);
                const nextWidth = clampSidebarWidth(resizeState.startWidth + delta);

                setSidebarWidth(nextWidth);
            };

            const handlePointerUp = () => {
                setIsSidebarResizing(false);
                resizeStateRef.current = null;
            };

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);

            return () => {
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
            };
        }, [clampSidebarWidth, isSidebarResizing, position, sidebarConfig]);

        useEffect(() => {
            if (!sidebarConfig) {
                setIsSidebarWidthLoaded(true);

                return;
            }

            setSidebarWidth(clampSidebarWidth(sidebarConfig.defaultWidth));
        }, [clampSidebarWidth, sidebarConfig]);

        useEffect(() => {
            let isActive = true;

            if (!sidebarConfig) {
                setIsSidebarWidthLoaded(true);

                return () => {
                    isActive = false;
                };
            }

            setIsSidebarWidthLoaded(false);

            const loadSidebarWidthPreference = async () => {
                if (!sidebarConfig.widthPreferenceKey || !window.api?.getUiPreference) {
                    if (isActive) {
                        setIsSidebarWidthLoaded(true);
                    }

                    return;
                }

                try {
                    const storedSidebarWidth = await window.api.getUiPreference(sidebarConfig.widthPreferenceKey);

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
        }, [clampSidebarWidth, sidebarConfig]);

        useEffect(() => {
            const api = window.api;
            const preferenceKey = sidebarConfig?.widthPreferenceKey;

            if (!sidebarConfig) {
                return;
            }
            if (
                !preferenceKey
                || !isSidebarWidthLoaded
                || isSidebarResizing
                || !api?.setUiPreference
            ) {
                return;
            }

            const persistSidebarWidthPreference = async () => {
                try {
                    await api.setUiPreference(
                        preferenceKey,
                        clampSidebarWidth(sidebarWidth),
                    );
                } catch (error) {
                    console.error('Failed to persist sidebar width preference', error);
                }
            };

            void persistSidebarWidthPreference();
        }, [clampSidebarWidth, isSidebarResizing, isSidebarWidthLoaded, sidebarConfig, sidebarWidth]);

        return {
            sidebarWidth,
            isSidebarResizing,
            handleSidebarResizeStart,
        };
    };

    const leftSidebarState = useResizableSidebar(resolvedLeftSidebar, 'left');
    const rightSidebarState = useResizableSidebar(resolvedRightSidebar, 'right');

    const contentNode = (
        <Box style={{ minWidth: 0, minHeight: 0, flex: 1 }}>
            {content}
        </Box>
    );

    const renderSidebarNode = (
        sidebarConfig: SidebarConfig | undefined,
        sidebarState: ReturnType<typeof useResizableSidebar>,
    ) => {
        if (!sidebarConfig) {
            return null;
        }

        return (
            <Box
                style={{
                    width: sidebarState.sidebarWidth,
                    minWidth: sidebarConfig.minWidth,
                    maxWidth: sidebarConfig.maxWidth,
                    minHeight: 0,
                    flexShrink: 0,
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
                        width: 2,
                        transform: 'translateX(-50%)',
                        backgroundColor: sidebarState.isSidebarResizing
                            ? 'var(--mantine-color-gray-5)'
                            : 'var(--mantine-color-gray-3)',
                    }}
                />
            </Box>
        );
    };

    return (
        <Box style={{ display: 'flex', gap: 0, minHeight: 0, flex: 1 }}>
            {renderSidebarNode(resolvedLeftSidebar, leftSidebarState)}
            {renderSeparatorNode(resolvedLeftSidebar, leftSidebarState)}
            {contentNode}
            {renderSeparatorNode(resolvedRightSidebar, rightSidebarState)}
            {renderSidebarNode(resolvedRightSidebar, rightSidebarState)}
        </Box>
    );
};
