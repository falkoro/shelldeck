use std::{fmt::Display, path::Path};

pub fn continue_after_disk_error<E: Display>(path: &Path, action: &str, error: &E) -> bool {
    #[cfg(feature = "saas")]
    {
        eprintln!(
            "ShellDeck saas: could not {action} {}: {error}; continuing with in-memory state",
            path.display()
        );
        true
    }
    #[cfg(not(feature = "saas"))]
    {
        let _ = path;
        let _ = action;
        let _ = error;
        false
    }
}
