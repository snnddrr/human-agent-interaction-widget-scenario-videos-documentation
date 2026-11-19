import assert from "node:assert/strict";
import { test } from "node:test";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

test("signed media links use private storage with the installed Blob SDK", async t => {
  // Exercise real URL signing; STORE_MOCK_DIR bypasses it and would hide a bad host.
  delete process.env.STORE_MOCK_DIR;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_playbacktest_testonly";
  process.env.VERCEL_BLOB_RETRIES = "0";
  const issued = [];
  const previous = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  t.after(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });
  agent.get("https://vercel.com").intercept({
    path: "/api/blob/signed-token", method: "POST",
  }).reply(200, ({ body }) => {
    const scope = { ...JSON.parse(body), storeId: "store_playbacktest" };
    issued.push(scope);
    return {
      delegationToken: Buffer.from(JSON.stringify(scope)).toString("base64url") + ".testonly",
      clientSigningToken: "test-only-signing-key",
      validUntil: scope.validUntil,
    };
  }).persist();
  const { signedGetUrl, signedPutUrl } = await import("../lib/store.js");

  await t.test("videos and posters resolve to the private Blob host", async () => {
    for (const pathname of ["videos/recording.mp4", "posters/recording.jpg"]) {
      const url = new URL(await signedGetUrl(pathname));
      assert.equal(url.hostname, "playbacktest.private.blob.vercel-storage.com");
      assert.equal(url.pathname, "/" + pathname);
      assert.ok(url.searchParams.get("vercel-blob-signature"));
    }
    assert.equal(issued.length, 1, "reuse the read delegation for both media links");
    assert.deepEqual(issued[0].operations, ["get"]);
  });

  await t.test("direct uploads retain their size and content-type constraints", async () => {
    const pathname = "videos/new-recording.mp4";
    const url = new URL(await signedPutUrl(pathname, {
      contentTypes: ["video/mp4"], maxBytes: 1024,
    }));
    assert.equal(url.hostname, "vercel.com");
    assert.equal(url.pathname, "/api/blob/");
    assert.equal(url.searchParams.get("pathname"), pathname);
    assert.ok(url.searchParams.get("vercel-blob-signature"));
    assert.equal(issued.length, 2);
    assert.equal(issued[1].pathname, pathname);
    assert.deepEqual(issued[1].operations, ["put"]);
    assert.deepEqual(issued[1].allowedContentTypes, ["video/mp4"]);
    assert.equal(issued[1].maximumSizeInBytes, 1024);
  });
});
