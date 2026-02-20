# Point Cloud Studio

An interactive 3D point cloud visualizer built with [Three.js](https://threejs.org/) and [Vite](https://vitejs.dev/).

## Features

- **Perlin-noise geometry** — points are displaced by 3D Perlin noise to form organic, cloud-like shapes
- **Live parameter controls** — adjust point count, cloud radius, noise scale/strength, and point size in real time
- **Network connections** — edges are drawn between nearby points, with configurable max distance, opacity, and line width
- **Drift animation** — the cloud slowly undulates over time; speed and amplitude are user-controllable
- **Seed-based generation** — reproduce any cloud exactly by entering its seed value
- **Screenshot export** — save a PNG of the current view with one click
- **Orbit / pan / zoom** — standard Three.js OrbitControls for full 3D navigation

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install & run

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

### Build for production

```bash
npm run build       # outputs to ./dist
npm run preview     # serve the production build locally
```

## Deployment

The project ships with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically builds and deploys to **GitHub Pages** on every push to `main`.

## Controls

| Control | Action |
|---|---|
| Left-drag | Orbit |
| Right-drag / Middle-drag | Pan |
| Scroll wheel | Zoom |
| REGENERATE button | Rebuild the cloud with the current seed |
| RND button | Pick a random seed and regenerate |
| SCREENSHOT button | Download a PNG snapshot |

## Tech Stack

| Library | Version | Purpose |
|---|---|---|
| [Three.js](https://threejs.org/) | ^0.169 | 3D rendering |
| [Vite](https://vitejs.dev/) | ^5.4 | Build tool & dev server |

## License

MIT
