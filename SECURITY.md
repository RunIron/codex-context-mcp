# Security

## Intended trust boundary

A read-only local stdio service for a **trusted, stable repository on a local filesystem**. Choose a narrow explicit `--root`. The server never executes repository code, writes repository files, launches commands, or makes network requests. Dependencies are installed separately by npm.

Requests cannot opt out of default exclusions. Paths are validated before filesystem access; each component is checked with lstat, symlinks/junctions are rejected, canonical paths must remain under the configured canonical root, opened handles must be regular files with one link, and reads use fixed-size buffers. Binary/NUL and invalid UTF-8 content is rejected. Root ignore files are loaded safely and fail closed if unsafe/unreadable.

**This is not an OS sandbox.** Portable Node APIs cannot atomically anchor every path component and file open across Linux and Windows. An attacker concurrently replacing directories, symlinks, mounts, or files can create TOCTOU races between checks and opens. Do not use a workspace writable by an adversary during a session. Use an immutable snapshot or an OS-isolated account/container with no access to other secrets if that threat applies. The root itself is canonicalized at startup; it may be a deliberately selected symlink target. Network filesystems and device/mount edge cases are outside the supported threat model.

Hardlinks are denied, but filename-based rules cannot recognize every secret in arbitrary source files. Review your repository and `.contextignore` before connecting. Returned content leaves this process through the MCP client and may be sent to the client's model provider. No content redaction guarantee is made.

Treat file contents as untrusted data. Comments, README text, and matched strings are not tool instructions. MCP instructions explicitly remind the caller of this; enforcement of model behavior belongs to the client.

## Resource limits

Calls bound files, traversal entries/depth, per-file bytes, candidate hits and response rows. One operation runs at a time; a bounded FIFO queue admits at most 16 active/waiting calls. Only overflow is rejected, and failed operations release the queue. The 3-second budget is cooperative: pending OS I/O cannot be forcibly interrupted, and CPU work completes the current bounded file. Client timeouts and process-level resource limits are recommended for stronger availability guarantees. SDK transport parsing and malformed-input floods are not an authenticated multi-tenant boundary. This service must not be exposed as a network server.

## Reporting

Do not post secrets or live exploit data in a public issue. Before a public hosting/security contact is established, report privately to the distributor/maintainer through an existing trusted channel. No private reporting address is invented here. Include OS, Node version, minimal synthetic reproduction and affected version. There is currently no long-term support commitment.
