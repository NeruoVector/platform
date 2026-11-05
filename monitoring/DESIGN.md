# NeuroVector interface

## 1. Identity
Operational dashboard following the existing App.css panels, buttons and system typography.
The whole-campus view prioritizes the real colored school geometry and current drone location.

## 2. Color
Existing dark surface #111c33, border #1e293b, text #e2e8f0, secondary text #94a3b8,
accent #2563eb and hover #16223c are the source for the campus CSS tokens.
The map uses a daylight background #dce7ed to preserve the mesh material colors.
Drone position uses #fbbf24; stale position uses #94a3b8. Ground #577a4d is the
existing Gazebo campus-ground material. Each marker has a textual location readout.

## 3. Typography
Use the existing system-ui / Segoe UI / Noto Sans KR stack. Heading 1.1rem/600,
body 1rem, metadata 0.875rem, line height1.5. Korean labels do not break within words.

## 4. Spacing and layout
Reuse panel padding1.5rem, gap1rem, compact gap0.5rem, radius12px and border1px.
The page remains within the existing1180px app width. Mobile controls wrap without
breaking tab labels; mobile map uses4:3 with260px minimum height.
Layout: campus view - fit the complete interactive scene in a responsive slot -> frame
(https://github.com/changeroa/StyleGallery/blob/main/patterns/media-fit/frame.md);
scroll owner: document; avoid fixed canvas widths and nested page scrollbars.
Layout: map actions - related controls must wrap -> cluster
(https://github.com/changeroa/StyleGallery/blob/main/patterns/in-line-grouping/cluster.md);
scroll owner: document; avoid overflowing single-row controls.

## 5. Components and brief
Primary action: 전체 보기 resets the viewport to the full campus.
Information priorities: school geometry; live drone position; freshness and numeric position.
Required: full colored model, actual live position and altitude, timestamp, stale/error states,
orbit/zoom, top view, focus drone, and existing navigation.
Primitives: existing panel and button (default/hover/focus/disabled), wrapping toolbar,
responsive canvas (loading/ready/error), status readout (waiting/live/stale/unavailable).
No simulated position or placeholder map substitutes for missing live data.

## 6. Interaction
Pointer/touch orbit and zoom, keyboard arrow rotation and +/- zoom when canvas focused.
Controls have44px minimum targets. Scene rendering pauses when the document is hidden.
Data updates once per second and stops on unmount. No automatic camera motion.

## 7. Accessibility
Canvas has an accessible name and keyboard instructions. Live position is also text.
Status changes use a polite live region without announcing every coordinate sample.
Visible focus and word-preserving Korean wrapping are required at390 and1440px.

## 8. Verification
Check real position changes, ENU-to-scene alignment, stale telemetry and failed assets,
map reset/top/focus controls, no horizontal overflow, WebGL resource cleanup and lazy loading.
Reuse the existing dark interface in either OS theme. No unrelated theme redesign.
