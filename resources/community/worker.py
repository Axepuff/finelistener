"""Protocol 1: local Community-1 inference on an already decoded waveform."""
import contextlib
import json
import os
from pathlib import Path
import sys

os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                  PYANNOTE_METRICS_ENABLED="0", DO_NOT_TRACK="1")


def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if request.get("protocol") != 1 or request.get("backend") not in ("cpu", "cuda"):
        raise ValueError("Invalid worker request")
    count = request.get("speakerCount")
    if count is not None and (type(count) is not int or count < 1):
        raise ValueError("Invalid speaker count")
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        import torch
        from pyannote.audio import Pipeline
        from pyannote.audio.core.task import Problem, Resolution, Specifications
        torch.serialization.add_safe_globals([Problem, Resolution, Specifications])
        torch.set_num_threads(4)
        samples, sample_rate = sf.read(request["audio"], dtype="float32", always_2d=True)
        if sample_rate != 16000 or samples.shape[1] != 1:
            raise ValueError("Expected mono 16 kHz waveform")
        device = torch.device(request["backend"])
        pipeline = Pipeline.from_pretrained(request["model"])
        pipeline.segmentation_batch_size = 4
        pipeline.embedding_batch_size = 4
        if device.type == "cuda":
            try:
                if not torch.cuda.is_available():
                    raise RuntimeError("CUDA is unavailable")
                probe = torch.randn(128, 128, device=device)
                (probe @ probe).sum().item()
                pipeline.to(device)
            except (RuntimeError, AssertionError) as error:
                print("CUDA initialization failed: " + str(error), file=sys.stderr)
                return 42
        else:
            pipeline.to(device)
        stages = {"segmentation": (0, 45), "speaker_counting": (45, 50),
                  "embeddings": (50, 90), "clustering": (90, 95),
                  "discrete_diarization": (95, 99)}
        last = -1

        def hook(step_name, step_artifact, file=None, total=None, completed=None):
            nonlocal last
            first, end = stages.get(step_name, (last, last))
            percent = first if not total or completed is None else first + (end - first) * completed / total
            percent = max(last, min(99, int(percent)))
            if percent > last:
                print(f"progress {percent}%", file=sys.stderr, flush=True)
                last = percent

        with torch.inference_mode():
            output = pipeline({"waveform": torch.from_numpy(np.ascontiguousarray(samples.T)),
                               "sample_rate": sample_rate}, hook=hook,
                              **({} if count is None else {"num_speakers": count}))
        duration = len(samples) / sample_rate

        def intervals(annotation):
            result = []
            for interval, _, label in annotation.itertracks(yield_label=True):
                start, end = max(0, interval.start), min(duration, interval.end)
                if end > start:
                    result.append({"startSec": start, "endSec": end, "speakerId": str(label)})
            return result

        result = {"protocol": 1, "backend": device.type,
                  "regularIntervals": intervals(output.speaker_diarization),
                  "exclusiveIntervals": intervals(output.exclusive_speaker_diarization)}
    print(json.dumps(result, allow_nan=False), flush=True)
    print("progress 100%", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
