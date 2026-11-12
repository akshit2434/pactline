# Contributing

Thanks for looking. Pactline is a hackathon project, so the bar is: small, tested, and safe with money.

1. `npm ci && npm test` must pass before and after your change (it runs offline in seconds).
2. Money logic lives in the pure state machine (`src/core/machine.js`). Any change there needs a test, and the property tests in `test/machine.test.js` must still hold.
3. Never let AI output move money directly. New proof types go through an oracle that returns a verdict; the engine and the machine decide.
4. Keep PayPal calls in `src/paypal/` and give every POST a `PayPal-Request-Id`.
5. Sandbox only. Do not commit keys: use `.env` (git-ignored).
6. One topic per pull request, with a short description of what changed and how you tested it.
