pub(crate) fn custom_label(name: &str) -> String {
    name.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn custom_badge(name: &str) -> String {
    let mut badge: String = name
        .split(['-', '_'])
        .filter_map(|part| part.chars().find(|c| c.is_ascii_alphanumeric()))
        .take(2)
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if badge.is_empty() {
        badge = "TM".to_string();
    }
    badge
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_tmux_sessions_get_real_badges() {
        assert_eq!(custom_badge("logan-runner"), "LR");
        assert_eq!(custom_badge("work"), "W");
        assert_eq!(custom_badge("---"), "TM");
    }

    #[test]
    fn custom_tmux_sessions_get_readable_labels() {
        assert_eq!(custom_label("logan-runner"), "Logan Runner");
        assert_eq!(custom_label("ai_house"), "Ai House");
    }
}
