# Security

Please do not publish credentials, signed resource URLs, student data, or exploit details in public issues. Report vulnerabilities privately through GitHub's **Security > Report a vulnerability** feature when available. If that option is unavailable, use the support form linked in privacy.html to request a private reporting channel before sharing sensitive details.

Only the current main branch receives fixes; no response-time guarantee is offered. Broad host access and Canvas DOM detection are documented in README.md. The project has not undergone an independent security audit.

Dependency review (October 31, 2026): npm audit reports 19 findings in the Jest development dependency tree (1 low, 18 moderate) after upgrading to Jest 30.5.2. These tools are excluded from the extension package. No npm production dependencies are installed; npm audit does not cover the vendored JSZip bundle. Do not use npm audit fix --force without reviewing its proposed toolchain changes.
