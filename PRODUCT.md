# AI Checkout product context

Confirmed from the project owner's build discussion: this is a Chrome extension portfolio project targeting full-stack software engineering and LLM application engineering (prompts, context, harnesses, tools, and evaluations). It should be usable and ready for public release even without marketing or significant traffic.

The user is a US shopper deciding which card they already own to use at an online checkout. The core job is to compare estimated rewards and understand the conditions. The extension records card product selections, not account/card numbers. Supported scope and uncertainty must be visible; calculations must not depend on model guesses.

The first implementation slice is two cards and one merchant, followed by a small verified catalog and 2–3 merchant integrations. Initial engineering defaults are Quicksilver, Blue Cash Everyday, and Best Buy US. These selections are reversible pilot choices, not user-specific financial recommendations.

The existing popup is a compact, light, blue-accented React interface inside Chrome. Extend this surface consistently. Prioritize readable amounts, clear labels, keyboard use, narrow-width layouts, recoverable errors, and offline behavior. No visual identity redesign was requested.

The administration audience is the project maintainer reviewing issuer terms and AI-proposed rule changes. AI cannot publish directly. This workflow needs an honest evaluation record and a complete frontend/API/database path.

Constraints: US/USD initially; minimal browser access; no bank linking, payments, wallet sync, or autonomous publication; no paid calls/purchases until a budget is set. Public publisher/support identity, hosting details, and paid AI budget remain undecided.
