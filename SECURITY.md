# Security Policy

NexTerm stores connection details and handles credentials, so security reports are taken seriously.

## Supported versions

Only the latest release (and the current `main` branch) receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**. If that is unavailable, contact the maintainer through the email on their GitHub profile.

Helpful details:

- What you found and its impact
- Steps to reproduce, or a proof of concept
- The NexTerm version and operating system

You can expect an acknowledgement within a few days. Valid reports are fixed as quickly as practical, and you will be credited in the release notes unless you prefer otherwise.

## Scope

In scope: credential handling and storage, host key verification, the main / renderer boundary (IPC, preload bridge, CSP), SFTP path handling, and the Telnet and SSH protocol code.

Out of scope: vulnerabilities in third-party servers you connect to, and issues that need an already-compromised local account.

See the [security model](docs/ARCHITECTURE.md#security-model) for how the application is designed to protect users.
