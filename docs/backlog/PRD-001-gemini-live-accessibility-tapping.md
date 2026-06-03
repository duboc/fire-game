# Product Requirement Document (PRD) — PRD-001: Gemini Live Voice-to-Tap Accessibility

## Metadata
*   **ID**: PRD-001
*   **Feature Name**: Gemini Live Voice-to-Tap (Vocal Tapping)
*   **Status**: Backlog / Proposed
*   **Author**: Antigravity AI
*   **Target Release**: v2.1.0-accessibility
*   **Epic Link**: Accessibility & Gamification Inclusivity

---

## 1. Product Context & Problem Statement
Tap Race: Enterprise Edition (TREE) is a high-energy live event game that requires players to tap a giant button on their mobile screens as fast as possible for 30–60 seconds. 

### The Problem
Traditional tapping mechanics are exclusionary. Players with physical disabilities, severe motor impairments, or missing fingers cannot participate in the event. In a massive live venue setting, this leaves valuable audience members excluded from the interactive experience. 

### The Solution
Implement an **independent voice-to-tap accessibility feature** powered by the **Google Gemini Live API**. This allows players to compete using vocal bursts instead of physical touch. A user can make rapid rhythmic vocalizations (such as *"la-la-la-la"*, *"ta-ta-ta"*, or *"pop-pop-pop"*) and have each spoken syllable instantly counted as a discrete, high-fidelity tap.

---

## 2. User Experience (UX) Flow

1.  **Discovery**: On the player lobby screen (`index.html`), an accessibility icon (microphone with an outline) is visible in the top-right corner.
2.  **Activation**: Tapping the icon opens an overlay modal explaining the "Vocal Tapping" feature.
3.  **Permissions**: The user grants permission for the browser to access their microphone.
4.  **Calibration & Practice**:
    *   The app displays a small target circle.
    *   The user is prompted to say a quick burst (e.g., *"la-la-la"*).
    *   The browser visually registers the sound. An animated wave bounces, showing a "Tap Registered!" pop-up to calibrate sensitivity.
5.  **Active Gameplay**:
    *   When the round starts, the massive tap button remains on screen but is styled with an outer pulsing audio ring.
    *   As the user says *"lalalalalalalala"*, each *"la"* triggers the identical local haptic feedback, button-shrink animation, and incremental score rise.
    *   An on-screen speech indicator flashes the recognized sounds in real-time.
    *   The background tap-batching service continues to package these inputs and ship them to the ingestion gateway transparently.

---

## 3. Technical Architecture (GCP Integration)

To support massive scalability and avoid overloading the main game engine, the vocal tap feature operates on a hybrid architecture that keeps the voice processing off the hot path of the core game server.

```
+-------------+      pcm audio stream      +--------------------+
|             | -------------------------> |                    |
| Mobile Client|                            | Gemini Live API    |
| (WebMic/WS) | <------------------------- | (Real-Time Audio)  |
|             |    phoneme text stream     +--------------------+
+-------------+
       |
       | batched taps (identical to standard HTTP POST /tap)
       v
+-----------------------------+
| Ingestion API (Cloud Run)   |
+-----------------------------+
```

### Component Details

#### 1. Ephemeral Token Vending Machine (`/auth/gemini-live`)
To prevent exposing the system's Google Vertex AI / Gemini API keys to the client browser, we introduce a secure token endpoint on our Cloud Run service:
*   **Endpoint**: `POST /auth/gemini-live`
*   **Protocol**: HTTPS (secured via OAuth/session token assigned during `/join`).
*   **Role**: Calls GCP Secret Manager to retrieve the master key, contacts Vertex AI / Gemini Auth to generate a scoped, ephemeral, single-use token valid only for the duration of the current round (e.g., 90 seconds).

#### 2. Client-Side Gemini Live WebSocket Connection
Once authenticated, the browser initiates a direct, low-latency WebSocket connection to the Google Gemini Multimodal Live API:
*   **Protocol**: `wss://generativelanguage.googleapis.com/ws/...`
*   **Input**: The mobile client uses the Web Audio API to capture microphone input as a low-bitrate, mono PCM stream (16kHz), which it continuously writes to the WebSocket channel.
*   **Configuration**:
    *   **Instruction**: *"You are an ultra-low latency syllable-counting assistant. Listen to the user's vocalizations (such as 'la', 'ta', 'pa', 'da'). Transcribe only the pure phonetic syllables separated by spaces as fast as they are uttered. Output nothing else. No punctuation, no corrections."*

#### 3. Real-Time Syllable Parser & Ingestion
As the Gemini Live API streams back real-time text chunks (e.g., `{"text": "la la la la"}`):
*   The client application's local JS parser monitors the incoming stream buffer.
*   It counts the occurrences of valid, newly-received phonetic boundary segments (using a high-performance regex matching phonetic syllable boundaries like `/([lptd][aeiou])/gi`).
*   For each matched syllable, it increments the local game counter and triggers local animations.
*   The existing batched `/tap` loop packages these counts and POSTs them to the Cloud Run Ingestion API every 100-200ms.

---

## 4. Safety & Ingestion Guardrails

To keep the accessibility feature purely focused on **fun, effortless participation, and maximum inclusivity**, there are **no anti-cheat checks or Vertex AI fraud filters applied to voice-vended taps**. Anyone using the vocal tap is welcome to make sounds as they wish without risk of being flagged or filtered.

The only guardrails in place are for client browser performance stability:

1.  **Rendering Stability Guardrail (Client-side)**:
    *   To prevent excessive rendering updates from freezing the mobile device or WebGL animations, vocal taps are paced at a stable client-side limit of **12 taps per second**.
2.  **Active Session Control**:
    *   The WebSocket session to the Gemini Live API automatically terminates the moment the game phase transitions to `ended`.

---

## 5. Non-Functional Requirements (NFRs)

*   **Latency**: The end-to-end voice-to-tap registration latency (spoken syllable -> Gemini Live analysis -> client recognition -> screen update) must remain **under 250ms** on stable cellular connections (5G / event Wi-Fi).
*   **Accuracy**: The phoneme recognizer must have a **>= 90% recognition rate** for basic rhythmic vocalizations (`la`, `ta`, `pa`), independent of speaker accents or vocal pitches.
*   **Battery Impact**: Sound capture and streaming must not thermal-throttle mid-tier mobile devices over a 60-second gameplay span.

---

## 6. Definition of Done (DoD)

- [ ] Complete implementation of the `POST /auth/gemini-live` token vending machine with Secret Manager integration.
- [ ] Implement browser-side microphone streaming using Web Audio API and WebSocket client wrapper.
- [ ] Create robust JavaScript phonetic parser to count voice peaks and trigger client-side tap animations.
- [ ] Add toggle-switch in mobile UI to calibrate the "Vocal Tap" mode.
- [ ] Conduct end-to-end local integration tests (simulated audio streams yielding accurate `/tap` Pub/Sub payloads).
- [ ] Verify smooth syllable-to-tap rendering and client-side pacing to prevent device freeze.
