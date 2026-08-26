use std::collections::HashMap;
use std::collections::hash_map::Entry;

use unicode_segmentation::UnicodeSegmentation as _;
use unicode_width::UnicodeWidthStr;

pub(crate) const MAX_CLUSTERS: usize = 4096;

#[derive(Debug, Default)]
pub(crate) struct ClusterPool {
    ids: HashMap<Box<str>, u32>,
    values: Vec<Box<str>>,
}

impl ClusterPool {
    pub(crate) fn intern(&mut self, value: &str) -> Option<u32> {
        if let Some(existing) = self.ids.get(value) {
            return Some(*existing);
        }
        if self.values.len() >= MAX_CLUSTERS {
            return None;
        }
        let id = u32::try_from(self.values.len()).ok()?;
        let stored: Box<str> = Box::from(value);
        self.values.try_reserve(1).ok()?;
        self.values.push(stored.clone());
        match self.ids.entry(stored) {
            Entry::Occupied(slot) => Some(*slot.get()),
            Entry::Vacant(slot) => {
                let assigned: &mut u32 = slot.insert(id);
                Some(*assigned)
            }
        }
    }

    pub(crate) fn get(&self, id: u32) -> Option<&str> {
        let index = usize::try_from(id).ok()?;
        self.values.get(index).map(AsRef::as_ref)
    }
}

pub(crate) fn grapheme_width(grapheme: &str) -> usize {
    UnicodeWidthStr::width(grapheme)
}

pub(crate) fn cell_width(value: &str) -> usize {
    value.graphemes(true).fold(0_usize, |total, grapheme| {
        total.saturating_add(grapheme_width(grapheme))
    })
}
