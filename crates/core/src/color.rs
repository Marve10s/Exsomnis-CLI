pub(crate) const CAP_TRUE_COLOR: u32 = 1;
pub(crate) const CAP_INDEXED_COLOR: u32 = 1 << 1;
pub(crate) const CAP_SYNCHRONIZED_OUTPUT: u32 = 1 << 2;

const TAG_TRUE_COLOR: u32 = 1;
const TAG_INDEXED: u32 = 2;

const CUBE_LEVELS: [u32; 6] = [0, 95, 135, 175, 215, 255];

const NAMED_PALETTE: [(u32, u32, u32); 16] = [
    (0, 0, 0),
    (128, 0, 0),
    (0, 128, 0),
    (128, 128, 0),
    (0, 0, 128),
    (128, 0, 128),
    (0, 128, 128),
    (192, 192, 192),
    (128, 128, 128),
    (255, 0, 0),
    (0, 255, 0),
    (255, 255, 0),
    (0, 0, 255),
    (255, 0, 255),
    (0, 255, 255),
    (255, 255, 255),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Color {
    Default,
    Named(u32),
    Indexed(u32),
    Rgb(u32, u32, u32),
}

const fn byte_at(value: u32, shift: u32) -> u32 {
    match value.checked_shr(shift) {
        Some(shifted) => shifted & 0xff,
        None => 0,
    }
}

pub(crate) const fn decode(value: u32) -> Color {
    match byte_at(value, 24) {
        TAG_TRUE_COLOR => Color::Rgb(byte_at(value, 16), byte_at(value, 8), byte_at(value, 0)),
        TAG_INDEXED => Color::Indexed(byte_at(value, 0)),
        _ => match byte_at(value, 0) {
            0 => Color::Default,
            other => {
                let index = other.saturating_sub(1);
                Color::Named(if index > 15 { 15 } else { index })
            }
        },
    }
}

const fn cube_step(value: u32) -> u32 {
    match value {
        0..=47 => 0,
        48..=114 => 1,
        115..=154 => 2,
        155..=194 => 3,
        195..=234 => 4,
        _ => 5,
    }
}

const fn distance(left: (u32, u32, u32), right: (u32, u32, u32)) -> u32 {
    let red = left.0.abs_diff(right.0);
    let green = left.1.abs_diff(right.1);
    let blue = left.2.abs_diff(right.2);
    red.saturating_mul(red)
        .saturating_add(green.saturating_mul(green))
        .saturating_add(blue.saturating_mul(blue))
}

fn cube_candidate(red: u32, green: u32, blue: u32) -> (u32, (u32, u32, u32)) {
    let steps = (cube_step(red), cube_step(green), cube_step(blue));
    let level = |step: u32| -> u32 {
        usize::try_from(step)
            .ok()
            .and_then(|index| CUBE_LEVELS.get(index).copied())
            .unwrap_or(0)
    };
    let color = (level(steps.0), level(steps.1), level(steps.2));
    let index = steps
        .0
        .saturating_mul(36)
        .saturating_add(steps.1.saturating_mul(6))
        .saturating_add(steps.2)
        .saturating_add(16);
    (index, color)
}

fn gray_candidate(red: u32, green: u32, blue: u32) -> (u32, (u32, u32, u32)) {
    let average = red
        .saturating_add(green)
        .saturating_add(blue)
        .checked_div(3)
        .unwrap_or(0);
    let mut best_step = 0_u32;
    let mut best_distance = u32::MAX;
    for step in 0_u32..24_u32 {
        let level = step.saturating_mul(10).saturating_add(8);
        let gap = level.abs_diff(average);
        if gap < best_distance {
            best_distance = gap;
            best_step = step;
        }
    }
    let level = best_step.saturating_mul(10).saturating_add(8);
    (best_step.saturating_add(232), (level, level, level))
}

pub(crate) fn to_indexed(red: u32, green: u32, blue: u32) -> u32 {
    let (cube_index, cube_color) = cube_candidate(red, green, blue);
    let (gray_index, gray_color) = gray_candidate(red, green, blue);
    let target = (red, green, blue);
    if distance(target, gray_color) < distance(target, cube_color) {
        gray_index
    } else {
        cube_index
    }
}

pub(crate) fn to_named(red: u32, green: u32, blue: u32) -> u32 {
    let target = (red, green, blue);
    let mut best_index = 0_u32;
    let mut best_distance = u32::MAX;
    for (index, entry) in NAMED_PALETTE.iter().enumerate() {
        let gap = distance(target, *entry);
        if gap < best_distance {
            best_distance = gap;
            best_index = u32::try_from(index).unwrap_or(0);
        }
    }
    best_index
}

pub(crate) fn indexed_to_rgb(index: u32) -> (u32, u32, u32) {
    if index < 16 {
        return usize::try_from(index)
            .ok()
            .and_then(|slot| NAMED_PALETTE.get(slot).copied())
            .unwrap_or((0, 0, 0));
    }
    if index >= 232 {
        let level = index
            .saturating_sub(232)
            .saturating_mul(10)
            .saturating_add(8);
        return (level, level, level);
    }
    let offset = index.saturating_sub(16);
    let red = offset.checked_div(36).unwrap_or(0);
    let green = offset
        .checked_rem(36)
        .unwrap_or(0)
        .checked_div(6)
        .unwrap_or(0);
    let blue = offset.checked_rem(6).unwrap_or(0);
    let level = |step: u32| -> u32 {
        usize::try_from(step)
            .ok()
            .and_then(|slot| CUBE_LEVELS.get(slot).copied())
            .unwrap_or(0)
    };
    (level(red), level(green), level(blue))
}
