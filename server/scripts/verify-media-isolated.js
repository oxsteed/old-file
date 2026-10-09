'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const { Pool } = require('pg');
const fixtures = require('./media-isolated-fixtures');

async function main() {
  fixtures.assertIsolated();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const base = 'http://127.0.0.1:5000/api/media';
  const postIds = [];
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'media-isolated-'));
  const headers = user => user ? { authorization: `Bearer ${jwt.sign({ id: user, role: 'helper' },
    process.env.JWT_SECRET, { expiresIn: '10m', algorithm: 'HS256' })}` } : {};
  async function api(route, user, body, method = 'GET') {
    const form = body instanceof FormData;
    const response = await fetch(`${base}${route}`, { method, headers: { ...headers(user),
      ...(!form && body ? { 'content-type': 'application/json' } : {}) },
    body: body == null ? undefined : form ? body : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  async function draft(user, extra = {}) {
    const result = await api('/posts', user, { body: `Synthetic Media check ${randomUUID()}`, draft: true, ...extra }, 'POST');
    assert.equal(result.status, 201,
      `verified publisher must create a private draft (received ${result.status}: ${JSON.stringify(result.data)})`);
    postIds.push(result.data.post.id); return result.data.post.id;
  }
  function file(post, bytes, name, type, replace = true) {
    const body = new FormData(); body.append('post_id', post); body.append('replace_assets', String(replace));
    body.append('file', new Blob([bytes], { type }), name); return body;
  }
  try {
    await fixtures.seed(pool);
    const { helper, business, restaurant, customer, blocked } = fixtures.personas;
    const scan = await require('../services/fileScanService').scanBuffer(Buffer.from('Synthetic harmless scanner check'));
    assert.equal(scan.provider, 'clamav'); assert.equal(scan.clean, true); assert.equal(scan.skipped, false);
    execFileSync('/usr/bin/ffmpeg', ['-version'], { stdio: 'ignore' });
    for (const [user, extra] of [[helper, {}], [business, { business_id: 905 }], [restaurant, {}]]) await draft(user, extra);
    const id = postIds[0];
    assert.equal((await api(`/posts/${id}`, null)).status, 404, 'private drafts must not be public');
    assert.equal((await api('/posts', customer, { body: 'Unauthorized publication' }, 'POST')).status, 403);
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#e95008' } }).jpeg().toBuffer();
    assert.equal((await api('/assets/photo-uploads', customer, file(id, photo, 'photo.jpg', 'image/jpeg'), 'POST')).status, 403);
    const upload = await api('/assets/photo-uploads', helper, file(id, photo, 'photo.jpg', 'image/jpeg'), 'POST');
    assert.equal(upload.status, 201);
    const replay = await api('/assets/photo-uploads', helper, file(id, photo, 'photo.jpg', 'image/jpeg'), 'POST');
    assert.equal(replay.data.asset.id, upload.data.asset.id, 'lost response retry must reuse the same asset');
    assert.equal((await api(`/posts/${id}/publish`, helper, {}, 'POST')).status, 200);
    for (const [postId, owner, name] of [[postIds[1], business, 'business.jpg'], [postIds[2], restaurant, 'restaurant.jpg']]) {
      assert.equal((await api('/assets/photo-uploads', owner, file(postId, photo, name, 'image/jpeg'), 'POST')).status, 201);
      assert.equal((await api(`/posts/${postId}/publish`, owner, {}, 'POST')).status, 200);
    }
    assert.equal((await api(`/posts/${id}`, null)).status, 200);
    assert.equal((await api(`/posts/${id}`, blocked)).status, 404, 'both directions of blocking hide public posts');
    assert.equal((await api('/assets/photo-uploads', helper, file(id, photo, 'photo.jpg', 'image/jpeg'), 'POST')).status, 409);

    const likeOn = await api(`/posts/${id}/like`, customer, {}, 'POST');
    assert.equal(likeOn.status, 200);
    assert.equal(likeOn.data.liked, true);
    assert.equal((await api(`/posts/${id}/like`, customer, {}, 'POST')).data.liked, false,
      'like retries must toggle the same personal state without duplicating a row');
    const bookmarkOn = await api(`/posts/${id}/bookmark`, customer, {}, 'POST');
    assert.equal(bookmarkOn.status, 200);
    assert.equal(bookmarkOn.data.bookmarked, true);
    const saved = await api('/posts/bookmarks', customer);
    assert(saved.data.posts.some(post => String(post.id) === String(id)), 'saved posts must return the bookmarked post');
    const repostOn = await api(`/posts/${id}/repost`, helper, {}, 'POST');
    assert.equal(repostOn.status, 200);
    assert.equal(repostOn.data.reposted, true);
    assert.equal((await api(`/posts/${id}/repost`, helper, {}, 'POST')).data.reposted, false,
      'repost retries must toggle the same actor state without duplicate rows');
    const shareOn = await api(`/posts/${id}/share`, null, {}, 'POST');
    assert.equal(shareOn.status, 200);
    assert.equal(shareOn.data.shared, true);
    assert.equal((await api(`/posts/${id}/share`, null, {}, 'POST')).data.shared, false,
      'guest shares must be unique for one request fingerprint');
    const viewOn = await api(`/posts/${id}/view`, null, {}, 'POST');
    assert.equal(viewOn.status, 200);
    assert.equal(viewOn.data.recorded, true);
    assert.equal((await api(`/posts/${id}/view`, null, {}, 'POST')).data.recorded, false,
      'guest views must be unique for one request fingerprint');
    const reportOn = await api(`/posts/${id}/flags`, customer, { reason: 'spam' }, 'POST');
    assert.equal(reportOn.status, 201);
    assert.equal((await api(`/posts/${id}/flags`, customer, { reason: 'spam' }, 'POST')).status, 409,
      'open duplicate reports must be rejected');

    const ownerPost = await draft(helper);
    assert.equal((await api('/assets/photo-uploads', helper, file(ownerPost, photo, 'owner.jpg', 'image/jpeg'), 'POST')).status, 201);
    assert.equal((await api(`/posts/${ownerPost}/publish`, helper, {}, 'POST')).status, 200);
    assert.equal((await api(`/posts/${ownerPost}`, customer, { body: 'Unauthorized edit' }, 'PATCH')).status, 404,
      'non-owners cannot edit a published post');
    assert.equal((await api(`/posts/${ownerPost}`, helper, { body: 'Owner edit' }, 'PATCH')).status, 200);
    assert.equal((await api(`/posts/${ownerPost}`, helper, {}, 'DELETE')).status, 200);
    assert.equal((await api(`/posts/${ownerPost}`, null)).status, 404, 'deleted posts are no longer public');

    const firstPage = await api('/feed?limit=2', null);
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.data.posts.length, 2, 'feed pagination should honor the requested page size');
    assert(firstPage.data.next_cursor, 'feed should return a cursor when another published post remains');
    const secondPage = await api(`/feed?limit=2&cursor=${encodeURIComponent(firstPage.data.next_cursor)}`, null);
    assert.equal(secondPage.status, 200);
    const pageIds = [...firstPage.data.posts, ...secondPage.data.posts].map(post => String(post.id));
    assert.equal(new Set(pageIds).size, pageIds.length, 'cursor pages must not repeat a post');
    const nearby = await api('/feed?limit=3&city=Springfield&state=OH', null);
    assert.equal(nearby.status, 200);
    assert.equal(nearby.data.location.city, 'Springfield');
    assert.equal(nearby.data.location.state, 'OH');
    const followedActor = firstPage.data.posts.find(post => String(post.owner_user_id) !== String(customer))?.actor_id;
    assert(followedActor, 'published fixture feed must expose an actor to follow');
    const followOn = await api(`/actors/${followedActor}/follow`, customer, {}, 'POST');
    assert.equal(followOn.status, 200);
    assert.equal(followOn.data.following, true);
    const followingFeed = await api('/feed?tab=following&limit=3', customer);
    assert.equal(followingFeed.status, 200);
    assert(followingFeed.data.posts.some(post => String(post.actor_id) === String(followedActor)),
      'Following should include posts from the followed actor');
    assert.equal((await api(`/actors/${followedActor}/follow`, customer, {}, 'POST')).data.following, false,
      'follow retries must remove the same relationship');
    const blockedFeed = await api('/feed?limit=3', blocked);
    assert.equal(blockedFeed.status, 200);
    assert(blockedFeed.data.posts.every(post => String(post.owner_user_id) !== String(helper)),
      'blocked authors must be excluded from every feed page');

    const videoId = await draft(helper);
    const videoPath = path.join(tmp, 'video.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=orange:s=320x240:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { stdio: 'ignore' });
    const video = await fs.readFile(videoPath);
    assert.equal((await api('/assets/video-uploads', customer, file(videoId, video, 'video.mp4', 'video/mp4'), 'POST')).status, 403);
    const videoUpload = await api('/assets/video-uploads', helper, file(videoId, video, 'video.mp4', 'video/mp4'), 'POST');
    assert.equal(videoUpload.status, 202);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const state = await api(`/posts/${videoId}/draft`, helper);
      if (state.data.draft.processing_status === 'ready') { ready = true; break; }
      assert.notEqual(state.data.draft.processing_status, 'failed');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert(ready, 'actual malware/quarantine/FFmpeg processing must reach ready');
    assert.equal((await api(`/posts/${videoId}/publish`, helper, {}, 'POST')).status, 200);
    const playback = await api(`/posts/${videoId}`, null);
    assert.equal(playback.status, 200);
    assert(playback.data.post.assets[0].renditions.length > 0);
    const asset = await fetch(playback.data.post.assets[0].url);
    assert.equal(asset.status, 200, 'ready rendition must be served');
    assert.equal((await api(`/posts/${id}/like`, customer, {}, 'POST')).status, 200);
    console.log(JSON.stringify({ ok: true, evidence: ['helper/business/restaurant drafts', 'ownership', 'guests',
      'two-way blocks', 'durable photo retries', 'personal action state', 'saved posts', 'reports',
      'owner edit/delete', 'real ClamAV', 'real FFmpeg', 'public rendition delivery'] }));
  } finally {
    // No financial writes. Keep moderation and artifact history scoped to this
    // disposable database; use the normal owner API for post removal.
    await pool.query("UPDATE media_posts SET visibility='removed',deleted_at=NOW() WHERE id=ANY($1::uuid[])", [postIds]).catch(() => {});
    await pool.end(); await fs.rm(tmp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
