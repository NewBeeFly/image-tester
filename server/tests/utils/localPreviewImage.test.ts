import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalImageRequestParts } from '../../src/utils/multimodalPrompt.js';

test('buildLocalImageRequestParts makes the uploaded image available as main', () => {
  const result = buildLocalImageRequestParts(
    '识别 {{img:main}}',
    '{}',
    Buffer.from('png-bytes'),
    'image/png',
  );

  assert.deepEqual(result.user, [
    { type: 'text', text: '识别 ' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,cG5nLWJ5dGVz' } },
  ]);
});

test('buildLocalImageRequestParts appends the local image without an image placeholder', () => {
  const result = buildLocalImageRequestParts('识别图片', '{}', Buffer.from('x'), 'image/png');

  assert.deepEqual(result.user, [
    { type: 'text', text: '识别图片' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,eA==' } },
  ]);
});

test('buildLocalImageRequestParts rejects extra image aliases', () => {
  assert.throws(
    () => buildLocalImageRequestParts('{{img:reference}}', '{}', Buffer.from('x'), 'image/png'),
    /本地图片模式只支持 {{img:main}}/,
  );
});
