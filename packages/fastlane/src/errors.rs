//! TPU error types and classification.
//!
//! Provides error codes that are exposed to TypeScript for
//! programmatic error handling and retry logic.

use std::fmt;

/// TPU error codes exposed to TypeScript.
///
/// These codes allow frontend applications to handle errors
/// programmatically and implement smart retry logic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TpuErrorCode {
    /// Failed to establish QUIC connection to validator.
    ConnectionFailed,
    /// Stream was closed by validator (evicted or disallowed).
    StreamClosed,
    /// Rate limited by validator (too many requests).
    RateLimited,
    /// No leaders available in the schedule.
    NoLeaders,
    /// Connection or send operation timed out.
    Timeout,
    /// Validator is unreachable via its gossip TPU address.
    ValidatorUnreachable,
    /// 0-RTT connection was rejected by validator.
    ZeroRttRejected,
}

impl TpuErrorCode {
    /// Returns the string representation for TypeScript.
    pub fn as_str(&self) -> &'static str {
        match self {
            TpuErrorCode::ConnectionFailed => "CONNECTION_FAILED",
            TpuErrorCode::StreamClosed => "STREAM_CLOSED",
            TpuErrorCode::RateLimited => "RATE_LIMITED",
            TpuErrorCode::NoLeaders => "NO_LEADERS",
            TpuErrorCode::Timeout => "TIMEOUT",
            TpuErrorCode::ValidatorUnreachable => "VALIDATOR_UNREACHABLE",
            TpuErrorCode::ZeroRttRejected => "ZERO_RTT_REJECTED",
        }
    }

    /// Returns whether this error is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            TpuErrorCode::ConnectionFailed
                | TpuErrorCode::StreamClosed
                | TpuErrorCode::RateLimited
                | TpuErrorCode::Timeout
        )
    }
}

impl fmt::Display for TpuErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Classify an error into a TpuErrorCode based on the error message.
pub fn classify_error(error: &anyhow::Error) -> TpuErrorCode {
    let msg = error.to_string().to_lowercase();

    if msg.contains("connection refused") || msg.contains("connection reset") {
        TpuErrorCode::ConnectionFailed
    } else if msg.contains("stream") && (msg.contains("closed") || msg.contains("reset")) {
        TpuErrorCode::StreamClosed
    } else if msg.contains("rate")
        || msg.contains("limit")
        || msg.contains("too many")
        || msg.contains("queue full")
        || msg.contains("channel full")
    {
        TpuErrorCode::RateLimited
    } else if msg.contains("timeout") || msg.contains("timed out") {
        TpuErrorCode::Timeout
    } else if msg.contains("0-rtt") || msg.contains("early data") {
        TpuErrorCode::ZeroRttRejected
    } else if msg.contains("no leader") || msg.contains("no schedule") {
        TpuErrorCode::NoLeaders
    } else {
        TpuErrorCode::ValidatorUnreachable
    }
}

/// Check if an error is retryable based on its message.
pub fn is_retryable_error(error: &anyhow::Error) -> bool {
    classify_error(error).is_retryable()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code_strings() {
        assert_eq!(TpuErrorCode::ConnectionFailed.as_str(), "CONNECTION_FAILED");
        assert_eq!(TpuErrorCode::StreamClosed.as_str(), "STREAM_CLOSED");
        assert_eq!(TpuErrorCode::Timeout.as_str(), "TIMEOUT");
    }

    #[test]
    fn test_retryable_errors() {
        assert!(TpuErrorCode::ConnectionFailed.is_retryable());
        assert!(TpuErrorCode::StreamClosed.is_retryable());
        assert!(TpuErrorCode::RateLimited.is_retryable());
        assert!(TpuErrorCode::Timeout.is_retryable());
        assert!(!TpuErrorCode::NoLeaders.is_retryable());
        assert!(!TpuErrorCode::ValidatorUnreachable.is_retryable());
        assert!(!TpuErrorCode::ZeroRttRejected.is_retryable());
    }
}
