# Contributing

Use Node.js 22 LTS, run npm ci, and run npm test -- --runInBand before submitting a pull request. Keep changes focused and explain the user-visible behavior and validation.

Test downloads manually on a Canvas course you are authorized to access. Include browser version and sanitized reproduction steps in issues. Never post credentials, signed URLs, student information, or course materials. Use synthetic fixtures.

Keep bundled dependencies local; extension code must not load executable code from a CDN. Preserve third-party licenses. Permission changes require an explanation of why the access is necessary and testing on custom Canvas domains.
