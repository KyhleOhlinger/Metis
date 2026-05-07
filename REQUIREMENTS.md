# Build Requirements

This document lists every system-level prerequisite needed to compile and run Metis from source.  
All Node.js and Rust package dependencies are managed automatically — `npm install` fetches the frontend packages and `cargo build` fetches the Rust crates.

> Full build instructions (commands, output locations, platform installers) are in [README.md](./specs/README.md).

---

## Required Tools

| Tool | Minimum Version | Install |
|------|----------------|---------|
| **Rust** (stable toolchain) | 1.77 | [rustup.rs](https://rustup.rs) |
| **Node.js** | 20 | [nodejs.org](https://nodejs.org) |
| **npm** | 10 | Bundled with Node.js |

> Cargo is bundled with Rust — no separate install needed.

---

## Platform-Specific Prerequisites

Tauri v2 requires native system libraries to build the WebView shell.  
See [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) for the official, always-up-to-date list.

### macOS

- **Xcode Command Line Tools**
  ```bash
  xcode-select --install
  ```
- **macOS 10.15 (Catalina) or later** (required for WKWebView)

### Windows

- **Microsoft C++ Build Tools** (Visual Studio 2019 or later)  
  Install the "Desktop development with C++" workload from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- **WebView2 Runtime** — pre-installed on Windows 10 (1803+) and Windows 11; available at [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### Linux (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

For other distros (Arch, Fedora, openSUSE) see the Tauri prerequisites page linked above.

---

## Optional

| Tool | Purpose |
|------|---------|
| [Tauri CLI](https://tauri.app/reference/cli/) (`cargo install tauri-cli`) | Run `cargo tauri dev / build` directly instead of via npm |

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/kyhleOhlinger/metis.git
cd metis

# 2. Install Node.js dependencies
npm install

# 3a. Run in development (Vite dev server + Tauri shell)
npm run dev

# 3b. — OR — produce a release build / installer
npm run build
```

The first build downloads and compiles all Rust crates from scratch (5–15 min). Subsequent builds are fast thanks to Cargo's incremental cache.
