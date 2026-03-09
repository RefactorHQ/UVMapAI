<p align="center">
  <img src="public/logo.png" alt="UVMAP AI" width="200" />
</p>

<h1 align="center">UVMAP AI</h1>

<p align="center">
  <strong>Enhance textures right where you see them.</strong>
</p>

<p align="center">
  <a href="https://github.com/RefactorHQ/UVMapAI/actions/workflows/ci.yml">
    <img src="https://github.com/RefactorHQ/UVMapAI/actions/workflows/ci.yml/badge.svg" alt="Build status" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  </a>
  <a href="https://uvmap.ai">
    <img src="https://img.shields.io/badge/uvmap.ai-live-brightgreen.svg" alt="uvmap.ai" />
  </a>
</p>

---

## Why this exists

I kept doing the same thing over and over: open a model, figure out which
texture maps to which face, crop the area in an image editor, upload it
somewhere, write a prompt, wait, download the result, paste it back. Repeat for
every surface that needed work. It's tedious and it breaks your flow.

[Nano Banana](https://fal.ai/models/fal-ai/nano-banana) genuinely changed what's
possible with texture enhancement. The quality is there. But the steps around
it still sucked: finding the right spot on the UV map, isolating it, getting it
back onto the model.

So I built this. You load a glTF, click on the part of the model you want to
fix, SAM3 masks the selection for you, and Nano Banana handles the enhancement.
One tool, start to finish.

## Demo

https://github.com/user-attachments/assets/f6473bcf-db62-4087-87d9-1409401dbb1d

## What it does

- **3D glTF viewer.** Load a glTF/GLB, orbit around it, click on any face to
  jump straight to that spot on the UV map.
- **SAM3 masking.** Click once and the segmentation model figures out what you
  meant to select. No manual lasso required.
- **Nano Banana editing.** The masked region goes to Nano Banana for
  enhancement. Results come back onto the texture automatically.
- **Undo/redo.** Every edit is tracked. Go back, compare, try something else.
- **Browser-local projects.** Your work persists in the browser between
  sessions. No account needed.
- **Self-hostable.** The SAM3 service runs on your own machine. Nothing leaves
  your network unless you want it to.
- **Single `docker compose up`.** App, SAM3 service, and asset service all
  start together.

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and
  [Docker Compose](https://docs.docker.com/compose/install/) installed on your
  machine.

### 1. Clone the repository

```bash
git clone https://github.com/RefactorHQ/UVMapAI.git
cd UVMapAI
```

### 2. Configure environment

Copy the example env file and add your keys:

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
GEMINI_API_KEY=your_gemini_api_key
HF_TOKEN=your_hugging_face_token
```

> **Bring your own key** or don't bother with local setup at all. You can
> **load credits on [uvmap.ai](https://uvmap.ai)** and use the hosted version
> right away.

### 3. Launch with Docker Compose

```bash
docker compose up --build
```

Open **[http://localhost:3000](http://localhost:3000)** and you're good to go.

| Service           | Port  | Description                        |
| ----------------- | ----- | ---------------------------------- |
| **app**           | 3000  | Next.js web application            |
| **sam-service**   | —     | SAM3 masking API (internal only)   |
| **asset-service** | —     | Image processing API (internal)    |

### Local Development (without Docker)

```bash
npm install
npm run dev
```

Requires Node.js 22+ and npm 10+.

## Tech Stack

| Layer     | Technology                                                        |
| --------- | ----------------------------------------------------------------- |
| Framework | Next.js 16.1, React 19, TypeScript 5                              |
| 3D        | Three.js 0.183, React Three Fiber 9, React Three Drei 10          |
| Canvas    | Konva 10, react-konva 19                                          |
| AI        | Gemini via @google/genai, SAM3 (segmentation), Nano Banana        |
| SAM svc   | Python, FastAPI, PyTorch, Transformers                             |
| Asset svc | Express 5, Sharp, gltfpack, ktx2-encoder                          |
| Testing   | Vitest 4, Testing Library                                         |
| Infra     | Docker, Docker Compose                                            |

## Contributing

PRs are welcome. Have a look at the [Contributing Guide](CONTRIBUTING.md) first.

## License

MIT. See [LICENSE](LICENSE) for details.

---

<p align="center">
  A project by <a href="https://refactor.nl"><strong>refactor.nl</strong></a>
</p>
