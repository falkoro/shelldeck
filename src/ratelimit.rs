use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

// In-memory lockout for the shell-unlock password. That secret is the last line of defense for
// live shell control — especially on a Cloudflare Access IP-bypass path, where the SSO factor is
// skipped and the unlock password is the *only* thing left — so we throttle guessing: too many
// misses from one client locks that client out for a cooldown. State is per-process and
// best-effort; a restart clears it, which is fine for a single-user dashboard.

const MAX_FAILS: u32 = 5;
const LOCKOUT_SECS: u64 = 15 * 60;
const FAIL_WINDOW_SECS: u64 = 15 * 60;
const MAX_TRACKED: usize = 1024;

#[derive(Default, Clone)]
struct Attempt {
    fails: u32,
    first_fail: u64,
    locked_until: u64,
}

#[derive(Default)]
pub struct UnlockLimiter {
    entries: HashMap<String, Attempt>,
}

pub fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl UnlockLimiter {
    // Seconds remaining on an active lockout for this key, or None if attempts are allowed.
    pub fn locked_for(&self, key: &str, now: u64) -> Option<u64> {
        self.entries
            .get(key)
            .filter(|a| a.locked_until > now)
            .map(|a| a.locked_until - now)
    }

    // Record a wrong password. Returns Some(remaining_secs) if this miss triggered a lockout.
    pub fn record_failure(&mut self, key: &str, now: u64) -> Option<u64> {
        self.prune(now);
        let entry = self.entries.entry(key.to_string()).or_default();
        // Reset a stale streak (not currently locked, last miss aged out) so occasional fumbles
        // over a long session don't silently accumulate into a lockout.
        if entry.locked_until <= now && now.saturating_sub(entry.first_fail) > FAIL_WINDOW_SECS {
            *entry = Attempt::default();
        }
        if entry.fails == 0 {
            entry.first_fail = now;
        }
        entry.fails += 1;
        if entry.fails >= MAX_FAILS {
            entry.locked_until = now + LOCKOUT_SECS;
            return Some(LOCKOUT_SECS);
        }
        None
    }

    pub fn record_success(&mut self, key: &str) {
        self.entries.remove(key);
    }

    // Bound memory: once the table is large, drop entries that are neither locked nor in an
    // active fail window.
    fn prune(&mut self, now: u64) {
        if self.entries.len() < MAX_TRACKED {
            return;
        }
        self.entries.retain(|_, a| {
            a.locked_until > now || now.saturating_sub(a.first_fail) <= FAIL_WINDOW_SECS
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_after_max_fails_and_reports_cooldown() {
        let mut limiter = UnlockLimiter::default();
        let now = 1_000;
        for _ in 0..(MAX_FAILS - 1) {
            assert_eq!(limiter.record_failure("ip", now), None);
            assert_eq!(limiter.locked_for("ip", now), None);
        }
        assert_eq!(limiter.record_failure("ip", now), Some(LOCKOUT_SECS));
        assert_eq!(limiter.locked_for("ip", now), Some(LOCKOUT_SECS));
        assert_eq!(limiter.locked_for("ip", now + LOCKOUT_SECS - 1), Some(1));
        assert_eq!(limiter.locked_for("ip", now + LOCKOUT_SECS), None);
    }

    #[test]
    fn success_clears_the_streak() {
        let mut limiter = UnlockLimiter::default();
        limiter.record_failure("ip", 10);
        limiter.record_failure("ip", 11);
        limiter.record_success("ip");
        assert_eq!(limiter.record_failure("ip", 12), None);
        assert_eq!(limiter.locked_for("ip", 12), None);
    }

    #[test]
    fn separate_keys_lock_independently() {
        let mut limiter = UnlockLimiter::default();
        for _ in 0..MAX_FAILS {
            limiter.record_failure("attacker", 5);
        }
        assert!(limiter.locked_for("attacker", 5).is_some());
        assert_eq!(limiter.locked_for("owner", 5), None);
    }

    #[test]
    fn stale_streak_resets_before_locking() {
        let mut limiter = UnlockLimiter::default();
        for _ in 0..(MAX_FAILS - 1) {
            limiter.record_failure("ip", 0);
        }
        // A lone miss long after the window must not tip an aged streak into a lockout.
        assert_eq!(limiter.record_failure("ip", FAIL_WINDOW_SECS + 100), None);
    }
}
