/// Truncate a string to at most `max_len` bytes on a valid char boundary.
pub(crate) fn truncate_to_char_boundary(mut s: String, max_len: usize) -> String {
    let safe_len = (0..=max_len.min(s.len()))
        .rev()
        .find(|&i| s.is_char_boundary(i))
        .unwrap_or(0);
    s.truncate(safe_len);
    s
}
