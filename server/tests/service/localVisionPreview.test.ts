import assert from 'node:assert/strict';
import test from 'node:test';
import { runLocalVisionPreview } from '../../src/service/visionPreviewService.js';

test('runLocalVisionPreview rejects a non-image MIME type before looking up a provider', async () => {
  await assert.rejects(
    () =>
      runLocalVisionPreview(null as never, {
        provider_profile_id: 1,
        user_prompt_template: '识别图片',
        image: { buffer: Buffer.from('not-an-image'), mimetype: 'text/plain' },
      }),
    /仅支持图片文件/,
  );
});
