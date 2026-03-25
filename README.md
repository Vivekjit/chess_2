# Chess 2 — The Double-Action Skirmish

Chess 2 is a tactical chess variant played on a **6×10 board** where **every piece gets two actions per turn**. The game ends when the opponent's **King is captured**.

## 🚀 Features
- **Minimax AI**: Play against the computer in a single-player mode.
- **Double-Action System**: Pre-computed 2-move chains with single-click execution.
- **Responsive UI**: Premium Chess.com-inspired aesthetics that adapt to mobile and laptop screens.
- **Multiplayer**: Integrated Socket.io for online room-based play.
- **Tactical Rules**: Enforced Rook movement (no backward), Pawn promotion, and King dash.

## 🚀 Phase 2: Advanced Upgrades
The project has been upgraded with premium tactical features:
- **Blue/Beige Theme**: A modern, low-strain aesthetic centered around `#4B7399`.
- **Pre-Game Lobby**: Choose your side (White/Dark) for local play; the board flips automatically.
- **Undo Move**: Persistent move history allows you to backtrack turns instantly.
- **Authoritative Timers**: Multiplayer rooms now feature server-side 5-minute clocks synced via Socket.io.
- **RL AI Environment**: A Gym-style wrapper (`chess2_env.js`) for training Reinforcement Learning agents.

## 🔗 Live Demo
Play the latest version on GitHub Pages:
**[https://vivekjit.github.io/chess_2/](https://vivekjit.github.io/chess_2/)**

## 🌐 Deployment
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Vivekjit/chess_2)

This project is optimized for **Render** (supports Node.js + WebSockets):
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Port**: 3000 (standard in server.js)

---
© 2026 Chess 2 Implementation by Antigravity
