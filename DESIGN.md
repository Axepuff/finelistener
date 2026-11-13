---
version: alpha
name: FineListener-design-system
description: A compact desktop audio and transcription workspace. White reading surfaces and pale gray sidebars frame a red waveform, dark neutral actions, and dense system-sans controls. Small corners, thin dividers, and local scrolling keep the transcript central. Color communicates audio position, search matches, recording, and status.

colors:
  primary: "#2E2E2E"
  on-primary: "#FFFFFF"
  canvas: "#FFFFFF"
  surface: "#F8F9FA"
  ink: "#000000"
  muted: "#868E96"
  hairline: "#DEE2E6"
  hairline-soft: "#E9ECEF"
  hairline-strong: "#ADB5BD"
  export: "#0F172A"
  export-hover: "#111F3B"
  focus: "#228BE6"
  waveform: "#E00D0D"
  playback-progress: "#C2480F"
  segment-overlay: "rgba(231, 255, 20, 0.2)"
  transcript-hover: "rgba(28, 77, 5, 0.12)"
  transcript-pressed: "rgba(28, 77, 5, 0.2)"
  search-match: "#FFEC99"
  search-match-active: "#FFA94D"
  recording: "#FA5252"

typography:
  body-md:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  speaker-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 18px
    letterSpacing: 0

rounded:
  none: 0px
  xs: 2px
  sm: 4px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 20px
  xl: 32px

components:
  sidebar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "{spacing.base}"
  transcript-panel:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-export:
    backgroundColor: "{colors.export}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-export-hover:
    backgroundColor: "{colors.export-hover}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  recording-control:
    backgroundColor: "{colors.recording}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    size: 48px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
  session-active:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 10px
  speaker-label:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.speaker-label}"
    padding: 2px 0
  speaker-speech:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 4px 8px
  search-match:
    backgroundColor: "{colors.search-match}"
    rounded: "{rounded.xs}"
  search-match-active:
    backgroundColor: "{colors.search-match-active}"
    rounded: "{rounded.xs}"
---

## Overview

FineListener is a desktop audio recording, playback, and transcription application. Users import audio or record microphone/system audio, select an optional segment, generate a transcript, listen while reading, and return to saved sessions.

The interface is a compact working tool: a full-width waveform above a three-column workspace, with the transcript as the main reading surface. Use light neutral surfaces, dark controls, thin dividers, small radii, and restrained semantic colors. Audio and transcript content provide the visual interest. Keep decoration subordinate to reading, listening, and editing.

Use native-feeling controls and Tabler-style outline icons. The established component vocabulary is Mantine. Prefer panels, toolbars, lists, and inline controls over a dashboard of unrelated cards. Reserve elevation for menus, popovers, dialogs, and notifications.

**Key Characteristics:**
- A full-width audio timeline anchors a three-column desktop workspace.
- White transcript canvas, pale gray side panels, dark neutral actions.
- System sans-serif typography at a compact 12–16 px working scale.
- Small 4 px corners; circles reserved for recording controls.
- Color marks meaningful audio and text states; content remains the visual focus.

This reference describes the local FineListener implementation, including work in progress, inspected on 2026-11-12. Token names normalize existing values for design generation; they are not exported application variables. Typography tokens describe Mantine defaults and explicit speaker-label styling, not an override of every component. Speaker labels can inherit session-specific speaker colors.

## Colors

The current theme uses Mantine's light scheme, `primaryColor: dark`, and its standard palettes. Hex values below reproduce the relevant Mantine defaults or explicit application colors.

| Role | Token / value | Usage |
| --- | --- | --- |
| Main surface | `#FFFFFF` | Transcript and active session surface |
| Secondary surface | `gray.0` / `#F8F9FA` | Side panels and quiet hover surfaces |
| Soft separator | `gray.2` / `#E9ECEF` | Subtle grouping and fragment rules |
| Border | `gray.3` / `#DEE2E6` | Standard boundaries |
| Strong selection border | `gray.5` / `#ADB5BD` | Active session outline |
| Secondary text | `gray.6` / `#868E96` | Metadata and dimmed text |
| Primary text | `#000000` | Mantine light-scheme body text |
| Primary control | `dark.6` / `#2E2E2E` | Filled neutral actions |
| Export action | `#0F172A`, hover `#111F3B` | Existing Save .txt button |
| Focus | `blue.6` / `#228BE6` | Explicit transcript keyboard focus |
| Search match | `yellow.2` / `#FFEC99` | Matching text |
| Active search match | `orange.4` / `#FFA94D` | Current match |
| Waveform | `#E00D0D` | Audio amplitude |
| Playback progress | `#C2480F` | Played position/progress |
| Segment overlay | `rgba(231, 255, 20, 0.2)` | Selected audio interval |
| Transcript hover | `rgba(28, 77, 5, 0.12)` | Seekable text hover; pressed alpha 0.20 |

Red also identifies recording and destructive/error controls; distinguish these by location, icon, and label. Waveform red does not indicate an error. Use Mantine semantic colors for alerts, retaining readable text and an icon or status label.

For new designs, verify contrast rather than assuming every inherited dimmed color is suitable for small text. Preserve the distinction between a search highlight, a selected audio segment, and a speaker passage.

## Typography

### Font Family & Hierarchy

Use the platform system sans-serif stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  Helvetica, Arial, sans-serif;
```

Roboto weights 300, 400, 500, and 700 are bundled, but the application does not override Mantine's system font stack. Do not interpret the bundled font as an exclusive brand typeface.

| Role | Size / treatment |
| --- | --- |
| Metadata and speaker labels | 12 px; speaker labels weight 600 |
| Compact UI labels and controls | 14 px |
| Standard reading text | 16 px baseline; preserve existing text-size controls where present |
| Small section titles | 16–18 px, medium or bold |
| Speaker transcript | Line height 1.5, left aligned |

Keep text left aligned and permit long names and transcript content to wrap. Use typographic hierarchy through size, weight, and spacing. New labels use sentence case; the existing uppercase SESSIONS label is a local exception.

## Layout

### Spacing System

Use `{spacing.xxs}` (4 px), `{spacing.xs}` (8 px), `{spacing.sm}` (12 px), `{spacing.base}` (16 px), `{spacing.md}` (20 px), and `{spacing.xl}` (32 px). These are portable design tokens. Mantine's named spacing differs: its `xs` is 10 px and `sm` is 12 px; do not map names blindly.

### Grid & Container

```text
+-------------------------------------------------------------------+
| Audio waveform, playback controls, position, segment selection     |
+----------------+----------------------------------+---------------+
| Import / record| Transcript views, search, actions | Sessions      |
|                |----------------------------------|               |
| Transcription  |                                  | Saved session |
| settings       | Transcript reading surface       | list          |
|                |                                  |               |
| Primary action |                                  |               |
+----------------+----------------------------------+---------------+
| Activity log                                                      |
+-------------------------------------------------------------------+
```

- Fill the application viewport. Keep the waveform above the columns and the activity log below them.
- Left panel: audio import, recording controls, transcription settings, and transcription action. Default width is 300 px.
- Center: flexible transcript panel with view controls, search, copy/export actions, and scrollable text. It receives the remaining width.
- Right panel: saved sessions. Default width is 360 px; it is absent when there are no sessions.
- Both sidebars are resizable, with widths persisted by the application. Current bounds are 10–480 px; 10 px is a collapsed-like extreme, not a readable content width.
- Sidebar padding is 16 px. Use 12–16 px between functional groups and smaller gaps within controls.
- Keep scrolling local to content panels so long transcripts and session lists do not push the player out of view.

### Whitespace Philosophy

Keep controls close to the content they operate on. Use 12–16 px between functional groups and 4–8 px inside related groups. Spend available space on transcript reading, not oversized headings or empty promotional bands.

## Elevation & Depth

| Level | Treatment | Use |
| --- | --- | --- |
| Workspace | Flat white and pale gray surfaces | Main reading area and sidebars |
| Separation | Thin gray rules | Panel boundaries and content grouping |
| Selection | White surface with a stronger gray outline | Active session |
| Overlay | Existing Mantine menu/dialog elevation | Temporary controls, dialogs, notifications |

The waveform and transcript highlights provide depth through position and color. Keep permanent panels flat. Preserve library overlay shadows rather than inventing a new shadow scale.

## Shapes

### Border Radius Scale

| Token | Value | Use |
| --- | --- | --- |
| `{rounded.none}` | 0 px | Edge-to-edge workspace regions |
| `{rounded.xs}` | 2 px | Search highlights |
| `{rounded.sm}` | 4 px | Default controls and speaker speech surfaces |
| `{rounded.full}` | 9999 px | Circular recording controls |

Small corners reinforce the compact desktop character. Full rounding is reserved for genuinely circular controls.

## Components

### Actions and inputs

Buttons, icon buttons, selects, number inputs, text inputs, checkboxes, and switches default to Mantine size `sm`. The theme overrides `md` buttons to 32 px high with 12 px horizontal padding; this is not a global height for all buttons. Use filled dark buttons for primary neutral actions, subtle controls for secondary tools, and red for destructive or recording actions.

Use familiar outline icons, generally 16 px in compact toolbars. Icon-only actions need an accessible name and a tooltip. Recording start/stop controls are circular, red, and 48 px in size. Keep their state unmistakable with a distinct icon and adjacent status.

### Audio player

The waveform is an interactive timeline, not a decorative illustration. Preserve playback, seeking, current position, segment start/end marking, and clearing the selection. Show a selected segment as a translucent overlay so the waveform remains visible. The existing Wavesurfer configuration uses a 100 px waveform height.

### Transcript

Use a compact toolbar with the existing view labels `Plain Text`, `Timecodes`, and `Speakers`, plus search and export actions. Search includes a result count, navigation, and clearing. Keep reading space dominant even when the toolbar wraps.

- **Plain Text:** speech text without timecodes or speaker labels.
- **Timecodes:** time positions and recording-source labels; clicking a time position seeks audio. Do not group this view by speaker.
- **Speakers:** passages grouped by speaker, with the speaker label linked to the passage start. Timecodes are hidden. The current layout uses a shared label column up to 9 rem wide, a flexible speech column, and an 8 px gap.
- Keep speaker settings in their dedicated popover/control. Assignment belongs beside the relevant passage; original fragments are progressively disclosed beneath it.
- Before speaker analysis, explain that the speaker transcript will appear after analysis and provide access to speaker settings. Do not fabricate speaker identities or show an analyzed transcript prematurely.

### Sessions and feedback

Represent sessions as a vertical list with title and compact metadata. The active session uses a white surface and a gray outline. Secondary actions belong in an overflow menu. Deletion requires confirmation explaining that audio and transcript files will be removed.

Keep notifications brief and close to their context. The existing copy notification sits 16 px from the bottom-right corner. The activity log is supporting history, not the transcript or the primary operation indicator.

### Token Mapping

Use `sidebar` for the two supporting panels, `transcript-panel` for the central reading surface, `button-primary` for filled neutral actions, and `button-export` for Save .txt. The `session-active` component adds a 1 px `{colors.hairline-strong}` outline. `search-match-active` replaces the ordinary match background for the current result. Recording controls use the filled color tokens above when filled; preserve the existing outlined variant where applicable.

### States

Include the states relevant to the requested flow; do not imply that a static mockup performs actual recording or transcription.

| State | Design requirement |
| --- | --- |
| Empty workspace | Make importing or recording the next clear action |
| Audio ready | Show playable audio and an available transcription action |
| Recording | Show active sources, elapsed/status information, level feedback, and stop control |
| Importing / opening / processing | Give visible progress or pending feedback; prevent conflicting actions |
| Transcribing | Distinguish provisional draft text from saved results |
| Complete transcript | Enable the applicable reading, search, copy, and save actions |
| Incomplete transcript | Preserve successful results and expose retry for remaining sources |
| Failure | Give a short, safe explanation and the applicable recovery action |
| Speaker analysis pending / unresolved | Distinguish unanalyzed content from an unknown speaker assignment |
| Long content | Keep toolbars usable, text wrapping, and panel scrolling intact |

Only one foreground operation owns the workspace at a time. Playback is not a foreground operation. Disabled actions should reflect real capability and operation state, rather than serving as decoration.

## Do's and Don'ts

### Do

- Keep the transcript as the dominant reading surface and playback accessible above it.
- Use dark neutral primary actions and the existing navy export treatment.
- Preserve distinct color roles for waveform, recording, search matches, and segment selection.
- Use compact Mantine controls, Tabler-style icons, thin dividers, and 4 px corners.
- Keep speaker identity separate from microphone/system recording sources.
- Show unfinished, incomplete, and failed operations honestly with relevant recovery actions.

### Don't

- Do not turn the workspace into a marketing page with a hero, pricing cards, or decorative gradients.
- Do not replace the system font with a display font or enlarge ordinary controls to landing-page proportions.
- Do not use the waveform red as a general-purpose brand CTA color.
- Do not add shadows to every panel or make all buttons pill-shaped.
- Do not fabricate speaker identities, completed transcription, or actual recording behavior in static mockups.

## Responsive Behavior

### Desktop & Narrow Windows

Recommended reference canvas: 1440 × 900. Also review at 1280 × 800 and a narrow desktop width. The transcript toolbar currently wraps at 900 px. For new narrow-window designs, preserve access to playback and transcript controls and allow secondary panels to collapse; treat any new collapse/navigation behavior as a proposal. A mobile application is outside the current baseline.

### Content Behavior

Let long transcript text and speaker names wrap. Preserve independent panel scrolling. Keep search counts on one line and allow toolbar action groups to wrap. The search field is normally 220 px wide; at the existing 900 px breakpoint it becomes flexible with a 180 px minimum.

### Accessibility & Motion

For generated designs, retain visible keyboard focus, logical navigation order, labeled controls, keyboard-accessible menus/dialogs, and readable contrast. Do not encode recording state, speaker identity, or errors through color alone. Retain clear targets around compact icons and usable resize handles.

Motion should explain an interaction. Existing transcript hover transitions last 150 ms; use similarly restrained feedback and respect reduced-motion preferences in new implementations. These are design requirements, not an audit of current accessibility support.

## Content & Voice

All new interface copy is English, concise, neutral, and action-oriented. Use labels such as `Copy transcript`, `Save .txt`, `Clear selection`, and `Analyze speakers`. Keep paths, process details, stack traces, and internal implementation names out of user-facing errors.

- **Workspace:** current work around one active session; do not rename it a project.
- **Session:** saved work with one audio source and its transcript, if present.
- **Audio source:** imported audio or a recording available for playback/transcription.
- **Recording source:** microphone or system audio; it is not a speaker.
- **Speaker:** a presumed voice within this session; names do not imply verified identity or recognition across sessions.
- **Segment:** an optional selected time range for a transcription run; no selection means the whole source.
- **Draft transcript:** provisional output from the current run.
- **Saved transcript:** persisted output, which may be incomplete.

## Iteration Guide

1. Identify the component and relevant state before changing its appearance.
2. Reuse the named colors, typography, spacing, radii, and component entries above.
3. Preserve the waveform / settings / transcript / sessions hierarchy.
4. Review long content, empty content, progress, errors, and keyboard focus where relevant.
5. Describe behavior beyond the current baseline as a proposal; update tokens and prose together when a design decision changes.

## Known Gaps

- The baseline is derived from source code, not a fresh screenshot or accessibility audit.
- A complete dark theme and mobile navigation pattern are not specified.
- Collapsing sidebars for narrow windows is a recommendation, not an implemented navigation contract.
- Readable contrast and reduced-motion handling are requirements for new designs; current conformance has not been verified.
- Speaker colors are session data, not a fixed brand palette.

## References

Format references: [Notion DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/notion/DESIGN.md) and [ElevenLabs DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/elevenlabs/DESIGN.md) from VoltAgent's awesome-design-md collection. Their YAML token structure and section organization are used here; FineListener retains its own visual language.

When the repository is available, resolve detailed behavior against these sources:

- `CONTEXT.md`: authoritative product terminology.
- `renderer/src/theme.ts` and `renderer/src/main.tsx`: theme and font setup.
- `renderer/src/Home.tsx`: workspace hierarchy and panel dimensions.
- `renderer/src/features/player/src/ui/Player/`: waveform and playback behavior.
- `renderer/src/features/transcribed-text/src/ui/TranscribedText/`: transcript layout, toolbar, speaker controls, and highlight styles.
- `renderer/src/features/sessions/src/ui/SessionsSidebar/SessionsSidebar.tsx`: session list and actions.
- `renderer/src/stories/Workspace.stories.tsx` and `Recorder.stories.tsx`: representative UI states; the latter is also under `renderer/src/stories/`.
