# Local Image Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Directly recognize one browser-selected local image without creating a suite asset, DB record, or test run.

**Architecture:** Add a multipart local-preview route that converts an in-memory buffer to a multimodal data URL. The existing suite-backed preview route remains unchanged. React adds a Local Image source mode to the preview page.

**Tech Stack:** React, TypeScript, Fastify multipart, Zod, Node test runner.

---

### Task 1: Buffer-backed prompt builder

**Files:** `server/src/utils/multimodalPrompt.ts`, `server/tests/utils/localPreviewImage.test.ts`

- [ ] Write a failing test for `buildLocalImageRequestParts('识别 {{img:main}}', '{}', Buffer.from('png-bytes'), 'image/png')`, asserting a text part and `data:image/png;base64,cG5nLWJ5dGVz` image part.
- [ ] Run `npm test --prefix server -- tests/utils/localPreviewImage.test.ts`; expect failure because the export does not exist.
- [ ] Implement a minimal builder that maps the uploaded image to `{{img:main}}`, auto-appends it when no image placeholder exists, and rejects other image aliases.
- [ ] Re-run the focused test; expect pass. Commit with `feat: build vision requests from local image buffers`.

### Task 2: Non-persistent upload endpoint

**Files:** `server/src/service/visionPreviewService.ts`, `server/src/controller/http.ts`, `server/tests/service/localVisionPreview.test.ts`

- [ ] Write a failing test showing `runLocalVisionPreview` rejects `text/plain` with `仅支持图片文件`.
- [ ] Run `npm test --prefix server -- tests/service/localVisionPreview.test.ts`; expect the missing export failure.
- [ ] Implement `runLocalVisionPreview`: resolve the Provider, validate the image MIME type, apply schema and params, build local request parts, then call `chatVision`. It must not read/write suites, files, cases, or runs.
- [ ] Add `POST /api/vision/preview-upload`: read one multipart `image` file and scalar preview fields, reject zero/multiple images, call the service. Reuse the configured 50MB file limit.
- [ ] Re-run the focused test; expect pass. Commit with `feat: add non-persistent local image preview API`.

### Task 3: Local Image UI mode

**Files:** `web/src/App.tsx`, `web/src/App.css`

- [ ] Add `previewMode: 'suite' | 'local'`, a single-image file input accepting PNG/JPEG/WebP/GIF/BMP, and a revocable object-URL thumbnail.
- [ ] In local mode, remove Test Suite and relative path requirements; send `FormData` to `/api/vision/preview-upload`. Preserve all current Provider, prompt, schema, and parameter controls and suite mode behavior.
- [ ] Run `npm run build --prefix web`; expect exit 0. Commit with `feat: add direct local image mode to preview`.

### Task 4: Documentation and complete verification

**Files:** `README.md`

- [ ] Document the local mode's one-request lifetime, no-persistence guarantee, accepted image formats, and 50MB limit.
- [ ] Run `npm test --prefix server`, `npm run build --prefix server`, and `npm run build --prefix web`; expect all commands to exit 0.
- [ ] Commit with `docs: describe local image preview mode`.
