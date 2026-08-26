pub(crate) const RING_FRAMES: usize = 240;

#[derive(Debug)]
struct Ring {
    values: [u32; RING_FRAMES],
    len: usize,
    next: usize,
}

impl Default for Ring {
    fn default() -> Self {
        Self {
            values: [0_u32; RING_FRAMES],
            len: 0,
            next: 0,
        }
    }
}

impl Ring {
    fn push(&mut self, value: u32) {
        if let Some(slot) = self.values.get_mut(self.next) {
            *slot = value;
        }
        self.next = self.next.saturating_add(1);
        if self.next >= RING_FRAMES {
            self.next = 0;
        }
        if self.len < RING_FRAMES {
            self.len = self.len.saturating_add(1);
        }
    }

    fn recorded(&self) -> Option<&[u32]> {
        self.values.get(..self.len)
    }

    fn mean(&self) -> f64 {
        let Some(values) = self.recorded() else {
            return 0.0_f64;
        };
        if values.is_empty() {
            return 0.0_f64;
        }
        let total = values
            .iter()
            .fold(0.0_f64, |sum, value| sum + f64::from(*value));
        total / f64::from(u32::try_from(values.len()).unwrap_or(u32::MAX))
    }

    fn percentile(&self, numerator: usize, denominator: usize) -> f64 {
        if self.len == 0 {
            return 0.0_f64;
        }
        let mut sorted = self.values;
        let Some(window) = sorted.get_mut(..self.len) else {
            return 0.0_f64;
        };
        window.sort_unstable();
        let last = self.len.saturating_sub(1);
        let index = last
            .saturating_mul(numerator)
            .checked_div(denominator)
            .unwrap_or(0)
            .min(last);
        window.get(index).copied().map_or(0.0_f64, f64::from)
    }

    fn maximum(&self) -> f64 {
        self.recorded()
            .and_then(|values| values.iter().copied().max())
            .map_or(0.0_f64, f64::from)
    }

    const fn reset(&mut self) {
        self.len = 0;
        self.next = 0;
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct StatsSnapshot {
    pub(crate) frames: f64,
    pub(crate) draw_micros_mean: f64,
    pub(crate) draw_micros_p95: f64,
    pub(crate) diff_micros_mean: f64,
    pub(crate) diff_micros_p95: f64,
    pub(crate) write_micros_mean: f64,
    pub(crate) write_micros_p95: f64,
    pub(crate) bytes_mean: f64,
    pub(crate) bytes_max: f64,
    pub(crate) bytes_total: f64,
    pub(crate) cells_total: f64,
}

#[derive(Debug, Default)]
pub(crate) struct Stats {
    draw: Ring,
    diff: Ring,
    write: Ring,
    bytes: Ring,
    frames: u64,
    bytes_total: u64,
    cells_total: u64,
}

fn as_float(value: u64) -> f64 {
    f64::from(u32::try_from(value).unwrap_or(u32::MAX))
}

impl Stats {
    pub(crate) fn record(&mut self, draw: u32, diff: u32, write: u32, bytes: u32, cells: u32) {
        self.draw.push(draw);
        self.diff.push(diff);
        self.write.push(write);
        self.bytes.push(bytes);
        self.frames = self.frames.saturating_add(1);
        self.bytes_total = self.bytes_total.saturating_add(u64::from(bytes));
        self.cells_total = self.cells_total.saturating_add(u64::from(cells));
    }

    pub(crate) fn take(&mut self) -> StatsSnapshot {
        let snapshot = StatsSnapshot {
            frames: as_float(self.frames),
            draw_micros_mean: self.draw.mean(),
            draw_micros_p95: self.draw.percentile(95, 100),
            diff_micros_mean: self.diff.mean(),
            diff_micros_p95: self.diff.percentile(95, 100),
            write_micros_mean: self.write.mean(),
            write_micros_p95: self.write.percentile(95, 100),
            bytes_mean: self.bytes.mean(),
            bytes_max: self.bytes.maximum(),
            bytes_total: as_float(self.bytes_total),
            cells_total: as_float(self.cells_total),
        };
        self.draw.reset();
        self.diff.reset();
        self.write.reset();
        self.bytes.reset();
        self.frames = 0;
        self.bytes_total = 0;
        self.cells_total = 0;
        snapshot
    }
}
