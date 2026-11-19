//! The set of appearance options a group may pick from. Empty strings mean
//! "not customised" — the UI keeps its default Home/dot glyph in that case.
//!
//! The very same keys live in `src/lib/groupStyle.ts` and `groupIcons.ts`;
//! keep both lists in sync or a stored value will be accepted by the database
//! but render as nothing.

pub const COLORS: &[&str] = &[
    "rose", "pink", "fuchsia", "purple", "violet", "indigo", "blue", "sky", "cyan", "teal",
    "green", "lime", "yellow", "amber", "orange", "red", "gold", "stone", "zinc", "slate",
];

pub const ICONS: &[&str] = &[
    "bot", "cpu", "dna", "microscope", "flask", "graduation", "brain", "database", "network", "workflow",
    "git", "server", "settings", "sliders", "toggle", "terminal", "code", "bug", "hash", "sync",
    "component", "blocks", "file", "filecode", "quote", "type", "pen", "pencil", "message", "messagetext",
    "clipboard", "notebook", "listchecks", "atsign", "languages", "link", "tag", "bookmark", "stamp", "sticker",
    "search", "help", "sparkles", "wand", "palette", "brush", "highlighter", "eraser", "aperture", "pipette",
    "scan", "scanline", "focus", "swatch", "shapes", "blend", "spline", "camera", "film", "clapper",
    "theater", "mic", "headphones", "scissors", "ruler", "music", "grid", "layout", "user", "users",
    "person", "face", "smile", "laugh", "meh", "frown", "eye", "shirt", "cat", "dog",
    "bird", "fish", "paw", "heart", "flower", "tree", "trees", "leaf", "sprout", "mountain",
    "waves", "home", "building", "store", "car", "plane", "bike", "anchor", "flame", "zap",
    "sun", "moon", "cloud", "rain", "snow", "wind", "droplet", "compass", "globe", "map",
    "flag", "bell", "party", "ghost", "rocket", "crown", "gem", "gift", "star", "trophy",
    "medal", "award", "target", "crosshair", "shield", "lock", "key", "badge", "check", "alert",
    "info", "hidden", "restricted", "archive", "pin", "trending", "scale", "filter", "folder", "folderopen",
    "foldertree", "image", "images", "fileimage", "layers", "box", "boxes", "package", "bag", "harddrive",
    "clouddownload", "download", "upload", "external", "library", "briefcase", "laptop", "phone", "mail", "share",
    "coffee", "pizza", "wine", "cake", "game", "puzzle", "dice", "clock", "calendar", "history",
    "lightbulb",
];

/// Unknown values are rejected instead of silently stored: a typo would show
/// up as a blank swatch in the UI and would be impossible to fix by hand.
pub fn clean_color(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || COLORS.contains(&value) {
        Ok(value.to_string())
    } else {
        Err("GROUP_COLOR_INVALID".to_string())
    }
}

pub fn clean_icon(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || ICONS.contains(&value) {
        Ok(value.to_string())
    } else {
        Err("GROUP_ICON_INVALID".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_values_are_validated() {
        assert_eq!(clean_color(" blue ").unwrap(), "blue");
        assert_eq!(clean_color("").unwrap(), "");
        assert_eq!(clean_color("neon").unwrap_err(), "GROUP_COLOR_INVALID");
        assert_eq!(clean_icon("sparkles").unwrap(), "sparkles");
        assert_eq!(clean_icon("paw").unwrap(), "paw");
        assert_eq!(clean_icon("not_an_icon").unwrap_err(), "GROUP_ICON_INVALID");
    }

    #[test]
    fn palettes_have_no_duplicates() {
        let mut colors = COLORS.to_vec();
        colors.sort_unstable();
        colors.dedup();
        assert_eq!(colors.len(), COLORS.len());
        let mut icons = ICONS.to_vec();
        icons.sort_unstable();
        icons.dedup();
        assert_eq!(icons.len(), ICONS.len());
    }
}
