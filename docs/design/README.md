# Workspace redesign: design handoff

Design source for the workspace redesign (#36). The screens were designed on the FineListener design system and exported here so they can be read without access to the design tool.

## Files

- `tokens.json`: design-system tokens. Colors for the light and dark themes (`color.tokens[].value.light` / `.dark`), type and fonts, spacing, radii, font sizes and control heights. The light theme is the main one.
- `screens/*.dc.html`: one file per screen, panel or state.
- `screens/Current.jpg`: the current workspace before the redesign, for comparison.

## How to read a screen file

Each `.dc.html` is plain HTML with inline styles. Colors are written as `var(--brand-…, #hex)`: the variable name is the token name from `tokens.json` and the hex value after the comma is the light-theme value. Sizes, gaps, radii and font sizes are literal px values.

The files are not meant to be opened directly in a browser: they need the design tool's runtime (`support.js`), which is not included. Read them as a specification instead:

- `<sc-for list="{{items}}" as="item">…</sc-for>` repeats its content for each entry of `items`; `<sc-if value="{{x}}">` shows its content when `x` is true.
- `{{…}}` values come from the `renderVals()` function in the `<script type="text/x-dc">` block at the end of the file. Repeated rows (sessions, transcript lines, waveform bars, level meters) are built there.
- Copy in the markup is representative English UI copy. Transcript text, names and numbers are sample content.

## Screens

Full window, drawn at 1440×900. See "Window size and panel widths" below for narrower windows.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | Session open, transcript in Speakers › Dialogue. Title bar, player strip, Sessions / transcript / Settings panels, status bar. Search with highlighted matches, selected segment on the waveform. |
| `Empty.dc.html` | No session open: record or import as the first actions, saved sessions on the left. |
| `StateRecording.dc.html` | Recording in progress: timer, written size, level meters per source. Import, other sessions, transcript views and Transcribe are locked with an explanation. |
| `StateTranscribing.dc.html` | Transcription in progress: step list with one overall percentage, lines appear as they are recognized, conflicting actions are locked. |

Transcript panel views, 780 px wide (the transcript panel at a 1440 px window):

| File | What it shows |
| --- | --- |
| `ViewText.dc.html` | Text: plain paragraphs, the passage being played is shaded. |
| `ViewTimecodes.dc.html` | Timecodes: one line per segment, current line marked, selected segment outlined. |
| `ViewReading.dc.html` | Speakers › Reading: continuous text, each passage tinted with its speaker color. (Speakers › Dialogue is `Main.dc.html`.) |
| `ViewSummary.dc.html` | Summary › Brief overview: prompt with presets, plain-text summary. |
| `ViewSummaryDetailed.dc.html` | Summary › Detailed notes: collapsed prompt, notes grouped by chunk. |
| `StateSummaryModel.dc.html` | Summary model not downloaded (2.50 GB): download action; prompt can be set up, generate is disabled. |
| `StateSummaryDownloading.dc.html` | Summary model downloading: progress, cancel, the rest of the app stays usable. |

Right panel, 360 px wide:

| File | What it shows |
| --- | --- |
| `StateWhisperDownload.dc.html` | Models as cards with size and status; Large downloading, other downloads disabled, transcribing with Large disabled until it is ready. |
| `StateSpeakerAnalysis.dc.html` | Step 3, Identify speakers, with its phases; the transcript is already saved. |
| `ErrTranscription.dc.html` | Incomplete transcription with "Retry remaining sources"; variant where nothing was transcribed. |
| `ErrSpeakers.dc.html` | Speaker analysis failed (GPU unavailable): switch to CPU and retry; variant where the component did not download. |

Error sheets, 780 px wide. Each block is labelled with where it appears:

| File | What it shows |
| --- | --- |
| `ErrRecording.dc.html` | Interrupted recording on launch, missing macOS system-audio permission, recording storage full, a silent source while recording, a source that stopped early. |
| `ErrModels.dc.html` | Whisper model download failed, not enough disk space for the summary model, interrupted summary model download, prompt too long, summary generation failed or stopped. |

## Window size and panel widths

- Minimum window size: 1024×640 (`minWidth` / `minHeight` on the `BrowserWindow`). Narrower windows are not supported.
- The three panels stay in one row and never wrap.

| Panel | Default | Minimum |
| --- | --- | --- |
| Sessions | 300 px | 240 px |
| Transcript | rest of the window | 440 px |
| Settings | 360 px | 320 px |

- As the window narrows, the side panels shrink from their default towards their minimum before the transcript goes below 440 px. 240 + 440 + 320 = 1000 px, so all three panels fit at the 1024 px minimum.
- User-resized side panel widths are clamped to these minimums and to whatever keeps the transcript at 440 px or more.
- Toolbars inside a panel (transcript view switcher, search, export) wrap to a second row when the panel is narrow. Each panel scrolls on its own; the window never scrolls.

## Text contrast

- All readable text, including 12 px captions, timecodes, group labels and metadata, uses `brand-color-text` or `brand-color-text-secondary` (`#595959`, about 7:1 on white and 6.5:1 on `#f5f5f5`).
- `brand-color-text-tertiary` (`#8c8c8c`, 3.36:1 on white) is not used for text in these designs. It may be used only for non-text graphics such as an outlined status dot, where 3:1 is enough.
- `brand-color-text-quaternary` is used only for disabled controls.

## Rules that apply to every screen

- Waveform rendering stays as it is now (library-dependent). Only the overlays around it are new: the selected segment and the playhead.
- One accent: the near-black primary. Blue only for links, focus and the playhead. Status colors only for status, always with an icon and a word. Text inside alerts and tags uses the normal text color.
- Errors appear where the action happened, with the action that fixes it next to the message, and a "Show in log" link for details.
- While recording or transcribing, actions that conflict with the running operation are disabled and say why.

## New behaviour shown in the designs

Some screens show behaviour that the current code does not have. Each of these needs its own issue:

- Summary prompt presets and "Save as preset".
- "Transcribe when recording stops" and "Generate automatically when the download finishes".
- "Use Base now" while a larger Whisper model downloads.
- "Skip speaker analysis".
- A warning when a recording source is silent for a while.
- Remaining-time estimates for downloads and transcription.
