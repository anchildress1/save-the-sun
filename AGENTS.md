# Agent Instructions for Save the Sun

- Use Node.js 26+ and ESM.
- Keep tests isolated.
- Follow architectural guidelines in `docs/prd.md`.
- No CJS shims.
- Config files may be modified **only to add to or raise coverage limits** — never to remove, lower, or weaken an existing coverage threshold.
- Keep inline code comments only when value is added to future dev work. Do not overdocument with useless info.
- Make atomic commits, GPG-signed, each with a `Signed-off-by:` footer (`git commit -s`).
