import type { Style } from '@/render/frame.ts';
import { ATTR_BOLD, ATTR_DIM, rgbColor, style } from '@/render/frame.ts';

const BACKGROUND = rgbColor(16, 18, 24);
const PANEL = rgbColor(24, 27, 36);
const TEXT = rgbColor(208, 214, 226);
const MUTED = rgbColor(118, 126, 144);
const ACCENT = rgbColor(122, 162, 247);
const SELECTED = rgbColor(38, 46, 66);
const OVERLAY = rgbColor(30, 34, 46);
const SUCCESS = rgbColor(126, 200, 140);
const WARNING = rgbColor(224, 175, 104);
const DANGER = rgbColor(224, 118, 118);

export const body: Style = style(TEXT, BACKGROUND);
export const bodyMuted: Style = style(MUTED, BACKGROUND, ATTR_DIM);
export const bodyAccent: Style = style(ACCENT, BACKGROUND, ATTR_BOLD);
export const bodyStrong: Style = style(TEXT, BACKGROUND, ATTR_BOLD);
export const bodySuccess: Style = style(SUCCESS, BACKGROUND);
export const bodyWarning: Style = style(WARNING, BACKGROUND);
export const bodyDanger: Style = style(DANGER, BACKGROUND);

export const panel: Style = style(TEXT, PANEL);
export const panelMuted: Style = style(MUTED, PANEL, ATTR_DIM);
export const panelAccent: Style = style(ACCENT, PANEL, ATTR_BOLD);
export const panelWarning: Style = style(WARNING, PANEL);
export const panelDanger: Style = style(DANGER, PANEL);
export const panelSuccess: Style = style(SUCCESS, PANEL);
export const panelSelected: Style = style(TEXT, SELECTED, ATTR_BOLD);

export const overlay: Style = style(TEXT, OVERLAY);
export const overlayMuted: Style = style(MUTED, OVERLAY, ATTR_DIM);
export const overlayAccent: Style = style(ACCENT, OVERLAY, ATTR_BOLD);
export const overlaySelected: Style = style(TEXT, SELECTED, ATTR_BOLD);
