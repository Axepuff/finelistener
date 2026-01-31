import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StopIcon from '@mui/icons-material/Stop';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { RecordingLevel, RecordingProgress, RecordingState } from 'electron/src/services/RecordingService';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import type { ScreenRecordingPermissionStatus } from 'electron/src/services/capture/ScreenCaptureKitAdapter';
import { useSetAtom } from 'jotai';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { atoms } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';

const formatDuration = (ms: number): string => {
    if (!Number.isFinite(ms) || ms < 0) return '0:00';

    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatLevel = (level: RecordingLevel | null): string => {
    if (!level) return 'N/A';

    const peak = Math.round(level.peak * 100);
    const clipped = level.clipped ? ' (clip)' : '';

    return `${peak}%${clipped}`;
};

// TODO refactor
export const SystemAudioRecorder: React.FC = () => {
    const { isElectron } = useApp();
    const setAudioToTranscribe = useSetAtom(atoms.transcription.audioToTranscribe);
    const setLog = useSetAtom(atoms.transcription.log);
    const [recordingState, setRecordingState] = useState<RecordingState>('idle');
    const [recordingDurationMs, setRecordingDurationMs] = useState(0);
    const [recordingLevel, setRecordingLevel] = useState<RecordingLevel | null>(null);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [permissionStatus, setPermissionStatus] = useState<ScreenRecordingPermissionStatus>('unknown');
    const [isRecordingAvailable, setIsRecordingAvailable] = useState(true);
    const [devices, setDevices] = useState<RecordingDevice[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [deviceError, setDeviceError] = useState<string | null>(null);
    const [isProcessingRecording, setIsProcessingRecording] = useState(false);
    const recordingStartRef = useRef<number | null>(null);
    const lastProgressAtRef = useRef<number | null>(null);

    const appendLog = useCallback((message: string) => {
        setLog((prev) => {
            const prefix = prev ? '\n' : '';
            const timestamp = new Date().toLocaleTimeString();

            return `${prev}${prefix}[${timestamp}] ${message}`;
        });
    }, [setLog]);

    useEffect(() => {
        if (!isElectron) return;

        void window.api?.isRecordingAvailable?.()
            .then((available) => setIsRecordingAvailable(Boolean(available)))
            .catch(() => setIsRecordingAvailable(false));
        void window.api?.getRecordingPermissionStatus?.()
            .then((status) => setPermissionStatus(status))
            .catch(() => setPermissionStatus('unknown'));
        void window.api?.getRecordingState?.()
            .then((state) => setRecordingState(state))
            .catch(() => setRecordingState('idle'));
        void window.api?.listRecordingDevices?.()
            .then((list: RecordingDevice[]) => {
                const normalized = list ?? [];

                setDevices(normalized);
                const preferred = normalized.find((device) => device.isDefault) ?? normalized[0];
                const id = preferred?.id ?? (preferred?.index !== undefined ? String(preferred.index) : '');

                setSelectedDeviceId(id);
                setDeviceError(null);
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);

                setDeviceError(message);
                setDevices([]);
            });
    }, [isElectron]);

    useEffect(() => {
        if (!isElectron) return;

        const offState = window.api?.onRecordingState?.((state) => setRecordingState(state));
        const offProgress = window.api?.onRecordingProgress?.((progress: RecordingProgress) => {
            setRecordingDurationMs(progress.durationMs);
            lastProgressAtRef.current = Date.now();
        });
        const offLevel = window.api?.onRecordingLevel?.((level: RecordingLevel) => {
            setRecordingLevel(level);
        });
        const offError = window.api?.onRecordingError?.((payload) => {
            setRecordingError(payload.message);
            appendLog(`Recording error: ${payload.message}`);
        });

        return () => {
            offState?.();
            offProgress?.();
            offLevel?.();
            offError?.();
        };
    }, [appendLog, isElectron]);

    useEffect(() => {
        if (recordingState === 'recording') {
            if (!recordingStartRef.current) {
                recordingStartRef.current = Date.now();
            }

            return;
        }

        recordingStartRef.current = null;
        lastProgressAtRef.current = null;
    }, [recordingState]);

    useEffect(() => {
        if (recordingState !== 'recording') return;

        const timer = window.setInterval(() => {
            if (!recordingStartRef.current) return;
            if (lastProgressAtRef.current && Date.now() - lastProgressAtRef.current < 800) {
                return;
            }

            setRecordingDurationMs(Date.now() - recordingStartRef.current);
        }, 200);

        return () => window.clearInterval(timer);
    }, [recordingState]);

    const handleStartRecording = async () => {
        if (!isElectron) return;

        setRecordingError(null);
        setRecordingLevel(null);
        setRecordingDurationMs(0);
        lastProgressAtRef.current = null;

        try {
            const status = await window.api!.getRecordingPermissionStatus();
            const available = await window.api!.isRecordingAvailable();

            setPermissionStatus(status);
            setIsRecordingAvailable(available);

            if (!available) {
                const message = 'System audio recording is unavailable (helper not found).';

                setRecordingError(message);
                appendLog(message);

                return;
            }

            if (status === 'restricted') {
                const message = 'Screen recording is restricted by system policy.';

                setRecordingError(message);
                appendLog(message);

                return;
            }

            if (status === 'denied') {
                appendLog('Screen recording permission is disabled for the app. Trying to request it via the helper.');
            }

            const session = await window.api!.startSystemRecording({
                deviceId: selectedDeviceId || undefined,
            });

            appendLog(`Recording started: ${session.filePath}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            setRecordingError(message);
            appendLog(`Failed to start recording: ${message}`);
        }
    };

    const handleStopRecording = async () => {
        if (!isElectron) return;

        setIsProcessingRecording(true);

        try {
            const result = await window.api!.stopSystemRecording();

            appendLog(`Recording finished: ${result.filePath}`);

            const { path } = await window.api!.convertAudio({
                audioPath: result.filePath,
                lowPass: 12000,
                highPass: 80,
                dynanorm: true,
            });

            setAudioToTranscribe([path]);
            appendLog('Audio prepared and loaded into the player.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            setRecordingError(message);
            appendLog(`Failed to stop recording: ${message}`);
        } finally {
            setIsProcessingRecording(false);
        }
    };

    const isRecordingActive = recordingState !== 'idle';

    const canStartRecording = isElectron
        && recordingState === 'idle'
        && !isProcessingRecording
        && isRecordingAvailable
        && permissionStatus !== 'restricted';
    const canStopRecording = isElectron && (recordingState === 'starting' || recordingState === 'recording' || recordingState === 'error');
    const showDeviceSelect = isElectron && devices.length > 0;

    const handleDeviceChange = (event: SelectChangeEvent<string>) => {
        setSelectedDeviceId(event.target.value);
    };

    const formatDeviceLabel = (device: RecordingDevice): string => {
        return device.isDefault ? `${device.name} (Default)` : device.name;
    };

    return (
        <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="center">
                <Button
                    variant="contained"
                    color="error"
                    startIcon={<FiberManualRecordIcon />}
                    disabled={!canStartRecording}
                    onClick={handleStartRecording}
                >
                    {'Record system audio'}
                </Button>
                <IconButton color="error" onClick={handleStopRecording} disabled={!canStopRecording}>
                    <StopIcon />
                </IconButton>
                {isProcessingRecording ? <CircularProgress size={18} /> : null}
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    {isRecordingActive ? `Recording: ${formatDuration(recordingDurationMs)}` : 'Recording inactive'}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    {`Level: ${formatLevel(recordingLevel)}`}
                </Typography>
                {showDeviceSelect ? (
                    <FormControl size="small" sx={{ minWidth: 240 }} disabled={isRecordingActive}>
                        <InputLabel id="system-audio-device-label">{'Output device'}</InputLabel>
                        <Select
                            labelId="system-audio-device-label"
                            value={selectedDeviceId}
                            label="Output device"
                            onChange={handleDeviceChange}
                        >
                            {devices.map((device) => {
                                const value = device.id || (device.index !== undefined ? String(device.index) : '');

                                if (!value) return null;

                                return (
                                    <MenuItem key={value} value={value}>
                                        {formatDeviceLabel(device)}
                                    </MenuItem>
                                );
                            })}
                        </Select>
                    </FormControl>
                ) : null}
            </Stack>
            {recordingState === 'recording' ? (
                <LinearProgress
                    variant="determinate"
                    color={recordingLevel?.clipped ? 'error' : 'primary'}
                    value={Math.min(100, Math.max(0, (recordingLevel?.peak ?? 0) * 100))}
                />
            ) : null}
            {recordingError ? (
                <Typography variant="body2" sx={{ color: 'error.main' }}>
                    {recordingError}
                </Typography>
            ) : null}
            {deviceError ? (
                <Typography variant="body2" sx={{ color: 'warning.main' }}>
                    {`Failed to load devices: ${deviceError}`}
                </Typography>
            ) : null}
            {!isRecordingAvailable ? (
                <Typography variant="body2" sx={{ color: 'warning.main' }}>
                    {'System audio recording is unavailable.'}
                </Typography>
            ) : null}
        </Stack>
    );
};
