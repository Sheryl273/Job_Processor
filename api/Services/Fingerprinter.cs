using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Api.Services;

/// <summary>
/// Stable fingerprinting and title generation for Failure DNA grouping.
/// </summary>
public static class Fingerprinter
{
    // ── Normalization regexes (compiled once) ─────────────────────────────────

    // GUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    private static readonly Regex _guidRx = new(
        @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        RegexOptions.Compiled);

    // 0x-prefixed hex literals
    private static readonly Regex _hexRx = new(
        @"0x[0-9a-fA-F]+",
        RegexOptions.Compiled);

    // Quoted strings (single or double)
    private static readonly Regex _quotedRx = new(
        @"""[^""]*""|'[^']*'",
        RegexOptions.Compiled);

    // Runs of digits
    private static readonly Regex _digitsRx = new(
        @"\d+",
        RegexOptions.Compiled);

    // Collapse whitespace
    private static readonly Regex _wsRx = new(
        @"\s+",
        RegexOptions.Compiled);

    // ── Public API ────────────────────────────────────────────────────────────

    /// <summary>
    /// Computes a 12-char lowercase hex fingerprint from exception metadata.
    /// SHA256( exceptionType | Normalize(message) | TopFrame(stackTrace) )
    /// </summary>
    public static string Fingerprint(string exceptionType, string message, string? stackTrace)
    {
        var raw = exceptionType + "|" + Normalize(message) + "|" + TopFrame(stackTrace);
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes)[..12].ToLowerInvariant();
    }

    /// <summary>
    /// Human-readable title for a failure group: "ExceptionType: NormalizedMessage".
    /// </summary>
    public static string Title(string exceptionType, string message)
        => exceptionType + ": " + Normalize(message);

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// <summary>
    /// Strips volatile identifiers from an exception message so that the same
    /// root-cause always produces the same token regardless of run-specific values.
    /// Order of substitution matters: GUIDs before digits (GUIDs contain digits).
    /// </summary>
    internal static string Normalize(string input)
    {
        if (string.IsNullOrEmpty(input)) return string.Empty;

        var s = _guidRx.Replace(input, "<guid>");
        s = _hexRx.Replace(s, "<hex>");
        s = _quotedRx.Replace(s, "<str>");
        s = _digitsRx.Replace(s, "<n>");
        s = _wsRx.Replace(s, " ").Trim();
        return s.ToLowerInvariant();
    }

    /// <summary>
    /// Extracts the first meaningful frame from a .NET stack trace:
    /// - Takes the first non-blank line
    /// - Strips the leading "at "
    /// - Removes everything from " in " onward (file path and line number)
    /// Returns empty string if no stack trace is provided.
    /// </summary>
    internal static string TopFrame(string? stackTrace)
    {
        if (string.IsNullOrWhiteSpace(stackTrace)) return string.Empty;

        var firstLine = stackTrace
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();

        if (firstLine is null) return string.Empty;

        // Strip leading "at "
        if (firstLine.StartsWith("at ", StringComparison.OrdinalIgnoreCase))
            firstLine = firstLine[3..];

        // Strip " in <path>:line N"
        var inIdx = firstLine.IndexOf(" in ", StringComparison.OrdinalIgnoreCase);
        if (inIdx >= 0)
            firstLine = firstLine[..inIdx];

        return firstLine.Trim();
    }
}
