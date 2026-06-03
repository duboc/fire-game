# Product Context — Tap Race: Enterprise Edition (TREE)

## Why This Project Exists
Tap Race is designed for live events (conferences, meetups, company parties) to engage audiences in a 30-60 second hyper-interactive mass gameplay. 
- **The Problem**: Standard games require downloading apps, setting up credentials, typing names, and navigating complex UI, causing users to lose interest before starting. Event Wi-Fi is notoriously flaky. Monolithic in-memory servers cannot scale beyond a few hundred players without degradation or risk of single-point failure (crashing the server ends the game).
- **The Solution**: Scan QR, receive an auto-generated funny identity (zero user input, zero moderation needed), and tap immediately.
- **The Overengineering Challenge Context**: By deploying this game on a microservice mesh over GCP, we guarantee the game can scale to **millions of concurrent users globally**, with isolated failures (e.g. if analytics crashes, the game keeps working), fraud-prevention, audit logs, and analytical dashboards.

## User Experience (UX) Goals
1. **Frictionless Entry**: Scan -> Land directly in lobby -> 3s load time.
2. **Instant Feedback**: Mobile button clicks trigger instant haptic feedback and local increment counter. Ranks must show `#X of Y` with sub-100ms latency.
3. **Smooth Leaderboard Animation**: The big screen should see the bars sliding up and down smoothly with FLIP row-entry animations.
4. **Post-Game Climax**: Visual celebration on the big screen with client-side confetti when the countdown hits zero, alongside winner identification and generation of certificates.
