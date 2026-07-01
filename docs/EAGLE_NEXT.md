# NVIDIA Eagle / LocateAnything next backend

This MVP uses MediaPipe in-browser for real-time finger geometry because it is fast enough for webcam FPS on a laptop.

NVIDIA Eagle / LocateAnything-3B is the next backend when the task becomes prompted grounding instead of hand-pose counting, e.g.:

- “Find the red mug.”
- “Draw a box around the keyboard.”
- “Which object is closest to my hand?”
- “Locate all UI buttons on this screen.”

## Verified source links

- GitHub: https://github.com/NVlabs/Eagle/tree/main/Embodied
- Hugging Face: https://huggingface.co/nvidia/LocateAnything-3B
- Project page: https://research.nvidia.com/labs/lpr/locate-anything/
- Paper: https://arxiv.org/abs/2605.27365

## Important license note

The Hugging Face model page says LocateAnything-3B is released under an NVIDIA non-commercial research license. Do not ship a commercial product on it without checking licensing.

## Architecture plan

```text
Browser webcam
  ├─ realtime mode: MediaPipe hand landmarks (current)
  └─ grounding mode: send sampled frame + text prompt to local/server backend
        └─ LocateAnything-3B returns boxes / points / labels
              └─ browser overlays boxes and labels on live camera
```

## Why not use Eagle for finger counting first?

Finger counting is mostly a hand-pose geometry task. A landmark model gives joint coordinates directly and runs locally at interactive FPS. LocateAnything is more powerful for open-vocabulary object grounding, but it is heavier, GPU-oriented, and better as a backend for prompted visual reasoning.

## Practical next step

Add a backend route:

```http
POST /api/ground
Content-Type: multipart/form-data
- image: current webcam frame
- prompt: "locate all fingertips"
```

Return:

```json
{
  "boxes": [{ "label": "index fingertip", "x1": 0.12, "y1": 0.2, "x2": 0.18, "y2": 0.29 }],
  "points": [{ "label": "thumb tip", "x": 0.4, "y": 0.6 }]
}
```
