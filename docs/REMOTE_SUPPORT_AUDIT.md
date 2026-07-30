# Remote support audit

NEXO detects an existing RustDesk client on Windows and opens it only after a visible user action. The application does not silently install RustDesk, start a remote connection, or grant unattended access.

Current integration scope:

- Detects `rustdesk.exe` in packaged resources, common per-user and system install directories, and `PATH`.
- Reports whether the client is installed before creating a support workflow.
- Opens the detected executable without a console window.
- Requires the user to share the ID shown by RustDesk and approve the connection.

Important boundary:

- The desktop client is open source, but the current NEXO build does not deploy or configure a private RustDesk Server OSS instance.
- Until a NEXO-owned `hbbs`/`hbbr` deployment is configured, the remote session infrastructure is not controlled by NEXO.
