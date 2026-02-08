import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StopIcon from '@mui/icons-material/Stop';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import React from 'react';
import { formatDuration, formatLevel, getRecordingDeviceId } from './core/recordingUtils';

const formatDeviceLabel = (device: RecordingDevice): string => {
    return device.isDefault ? `${device.name} (Default)` : device.name;
};

export const SystemAudioRecorderControls: React.FC = () => {
    const {
        controls: {
            canStartRecording,
            canStopRecording,
            isRecordingActive,
            isProcessingRecording,
            recordingDurationMs,
            recordingLevel,
            recordingBytesWritten,
            devices,
            selectedDeviceId,
            showDeviceSelect,
            onStartRecording,
            onStopRecording,
            onDeviceChange,
        },
    } = useSystemAudioRecorder();

    const levelLabel = formatLevel(recordingLevel);
    const durationLabel = formatDuration(recordingDurationMs);
    const writtenLabel = recordingBytesWritten !== null
        ? `Written: ${Math.round(recordingBytesWritten / 1024)} KB`
        : 'Written: N/A';

    const handleDeviceChange = (event: SelectChangeEvent<string>) => {
        onDeviceChange(event.target.value);
    };

    return (
        <Stack direction="row" spacing={2} alignItems="center">
            <Button
                variant="contained"
                color="error"
                startIcon={<FiberManualRecordIcon />}
                disabled={!canStartRecording}
                onClick={onStartRecording}
            >
                {'Record system audio'}
            </Button>
            <IconButton color="error" onClick={onStopRecording} disabled={!canStopRecording}>
                <StopIcon />
            </IconButton>
            {isProcessingRecording ? <CircularProgress size={18} /> : null}
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {isRecordingActive ? `Recording: ${durationLabel}` : 'Recording inactive'}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {`Level: ${levelLabel}`}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {writtenLabel}
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
                            const value = getRecordingDeviceId(device);

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
    );
};
