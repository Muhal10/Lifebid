const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

test("auction API keeps bids private and prevents duplicate bids", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifebid-test-"));
  const port = 31000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DEMO_ADMIN_PHONE: "+251912846151", DATA_DIR: dataDir, STORE_FILE: path.join(dataDir, "store.json") },
    stdio: "ignore",
  });
  t.after(() => {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const requestCode = async (phone, intent, credentials = {}) => {
    const response = await fetch(`${base}/api/auth/request-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, intent, ...credentials }),
    });
    return { response, body: await response.json() };
  };
  const verifyCode = (phone, intent, code, passwordSetup = {}) => fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code, intent, ...passwordSetup }),
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/bootstrap`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "server should start");
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  assert.equal(bootstrap.auctions.length, 4);
  assert.equal(bootstrap.auctions[0].entryFee >= 30 && bootstrap.auctions[0].entryFee <= 95, true);
  assert.equal(JSON.stringify(bootstrap).includes('"bids"'), false);
  assert.equal(bootstrap.smsPreview, true);

  const phone = "+251911123456";
  const unknownSignin = await requestCode(phone, "signin");
  assert.equal(unknownSignin.response.status, 404);
  const tooShortPassword = await requestCode(phone, "signup", {
    password: "1234",
    confirmPassword: "1234",
  });
  assert.equal(tooShortPassword.response.status, 400);
  const password = "abcde";
  const minimumPasswordSignup = await requestCode(phone, "signup", {
    password,
    confirmPassword: password,
  });
  assert.equal(minimumPasswordSignup.response.status, 200);
  const signupChallenge = minimumPasswordSignup;
  assert.match(signupChallenge.body.previewCode, /^\d{6}$/);
  const login = await (await verifyCode(phone, "signup", signupChallenge.body.previewCode)).json();
  assert.ok(login.token);
  const savedStore = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const savedUser = savedStore.users.find((user) => user.phone === phone);
  assert.match(savedUser.passwordHash, /^[\da-f]{128}$/);
  assert.match(savedUser.passwordSalt, /^[\da-f]{32}$/);
  assert.equal(Object.hasOwn(savedUser, "password"), false);
  assert.equal(Object.hasOwn(savedUser, "confirmPassword"), false);
  assert.equal((await verifyCode(phone, "signup", signupChallenge.body.previewCode)).status, 400);
  const duplicateSignup = await requestCode(phone, "signup", {
    password,
    confirmPassword: password,
  });
  assert.equal(duplicateSignup.response.status, 409);
  const wrongPassword = await requestCode(phone, "signin", { password: "Wrong-password-123" });
  assert.equal(wrongPassword.response.status, 401);
  const signinChallenge = await requestCode(phone, "signin", { password });
  const existingSignin = await verifyCode(phone, "signin", signinChallenge.body.previewCode);
  assert.equal(existingSignin.status, 200);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` };
  const bidResponse = await fetch(`${base}/api/bids`, {
    method: "POST", headers, body: JSON.stringify({ auctionId: bootstrap.auctions[0].id, amount: 127 }),
  });
  assert.equal(bidResponse.status, 201);
  const duplicate = await fetch(`${base}/api/bids`, {
    method: "POST", headers, body: JSON.stringify({ auctionId: bootstrap.auctions[0].id, amount: 128 }),
  });
  assert.equal(duplicate.status, 409);

  const strangerPhone = "+251922223333";
  const strangerChallenge = await requestCode(strangerPhone, "signup", {
    password: "Another-test-password-43",
    confirmPassword: "Another-test-password-43",
  });
  const stranger = await (await verifyCode(strangerPhone, "signup", strangerChallenge.body.previewCode)).json();
  const secondBid = await fetch(`${base}/api/bids`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${stranger.token}` },
    body: JSON.stringify({ auctionId: bootstrap.auctions[0].id, amount: 127 }),
  });
  assert.equal(secondBid.status, 201);

  const thirdPhone = "+251933334444";
  const thirdChallenge = await requestCode(thirdPhone, "signup", {
    password: "Third-test-password-654",
    confirmPassword: "Third-test-password-654",
  });
  const thirdUser = await (await verifyCode(thirdPhone, "signup", thirdChallenge.body.previewCode)).json();
  const uniqueBid = await fetch(`${base}/api/bids`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${thirdUser.token}` },
    body: JSON.stringify({ auctionId: bootstrap.auctions[0].id, amount: 90 }),
  });
  assert.equal(uniqueBid.status, 201);

  const adminPhone = "+251912846151";
  const adminPassword = "Administrator-test-password-76";
  const adminSignupChallenge = await requestCode(adminPhone, "signup", {
    password: adminPassword,
    confirmPassword: adminPassword,
  });
  const admin = await (await verifyCode(adminPhone, "signup", adminSignupChallenge.body.previewCode)).json();
  const adminSigninChallenge = await requestCode(adminPhone, "signin", { password: adminPassword });
  assert.equal(adminSigninChallenge.response.status, 200);
  const adminSignin = await verifyCode(adminPhone, "signin", adminSigninChallenge.body.previewCode);
  assert.equal(adminSignin.status, 200);
  const adminHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` };
  const newAuction = {
    name: "Uploaded image test",
    category: "Phones",
    condition: "New",
    description: "An auction created with an uploaded item photo.",
    delivery: "Delivery arranged with the winner.",
    entryFee: 50,
    closesAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  };
  const unauthorizedImageUpload = await fetch(`${base}/api/admin/auctions`, {
    method: "POST",
    headers: { ...adminHeaders, Authorization: `Bearer ${stranger.token}` },
    body: JSON.stringify({ ...newAuction, imageData: "data:image/png;base64,AA==" }),
  });
  assert.equal(unauthorizedImageUpload.status, 403);
  const invalidImage = await fetch(`${base}/api/admin/auctions`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ ...newAuction, imageData: "data:image/png;base64,ZmFrZQ==" }),
  });
  assert.equal(invalidImage.status, 400);
  const pngData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WfQAAAAASUVORK5CYII=";
  const imageUpload = await fetch(`${base}/api/admin/auctions`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ ...newAuction, imageData: `data:image/png;base64,${pngData}` }),
  });
  assert.equal(imageUpload.status, 201);
  const uploadedAuction = await imageUpload.json();
  const uploadedBootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  const uploadedImagePath = uploadedBootstrap.auctions.find((auction) => auction.id === uploadedAuction.auction.id).product.image;
  assert.match(uploadedImagePath, /^\/uploads\/[a-f\d-]+\.png$/i);
  const uploadedImage = await fetch(`${base}${uploadedImagePath}`);
  assert.equal(uploadedImage.status, 200);
  assert.equal(uploadedImage.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await uploadedImage.arrayBuffer()), Buffer.from(pngData, "base64"));
  const closeResponse = await fetch(`${base}/api/admin/close-auction`, {
    method: "POST", headers: adminHeaders, body: JSON.stringify({ auctionId: bootstrap.auctions[0].id }),
  });
  assert.equal(closeResponse.status, 200);
  const closeResult = await closeResponse.json();
  assert.equal(closeResult.result.outcome, "lowest-unique");
  assert.equal(closeResult.result.winningBid, 90);

  const ownSummary = await (await fetch(`${base}/api/user/summary`, {
    headers: { Authorization: `Bearer ${login.token}` },
  })).json();
  assert.equal(ownSummary.bids.length, 1);
  assert.equal(ownSummary.bids[0].amount, 127);

  const overview = await (await fetch(`${base}/api/admin/overview`, { headers: adminHeaders })).json();
  assert.equal(overview.bids.filter((bid) => bid.auctionId === bootstrap.auctions[0].id).length, 3);
  const unauthorizedSettlement = await fetch(`${base}/api/admin/settlement`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ auctionId: bootstrap.auctions[0].id, confirmed: false }),
  });
  assert.equal(unauthorizedSettlement.status, 400);
  const settlement = await fetch(`${base}/api/admin/settlement`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ auctionId: bootstrap.auctions[0].id, confirmed: true }),
  });
  assert.equal(settlement.status, 200);
});

test("existing passwordless admin sets a password after phone verification", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifebid-legacy-test-"));
  const storeFile = path.join(dataDir, "store.json");
  const port = 41000 + Math.floor(Math.random() * 10000);
  const adminPhone = "+251912846151";
  fs.writeFileSync(storeFile, JSON.stringify({
    products: [],
    auctions: [],
    users: [{ id: "existing-admin", phone: adminPhone, role: "admin", firstName: "Administrator" }],
    bids: [],
    payments: [],
    auditLog: [],
    policy: "Published tie-break rule.",
    fallbackRule: "earliest-lowest",
    recentWinners: [],
  }));
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, STORE_FILE: storeFile },
    stdio: "ignore",
  });
  t.after(() => {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/bootstrap`)).ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "server should start");

  const codeResponse = await fetch(`${base}/api/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: adminPhone, intent: "signin" }),
  });
  const challenge = await codeResponse.json();
  assert.equal(challenge.passwordSetupRequired, true);
  assert.match(challenge.previewCode, /^\d{6}$/);

  const newPassword = "Migrated-admin-password-93";
  const verified = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: adminPhone,
      intent: "signin",
      code: challenge.previewCode,
      newPassword,
      confirmPassword: newPassword,
    }),
  });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).user.role, "admin");
  const persisted = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  assert.ok(persisted.users[0].passwordHash);
  assert.equal(Object.hasOwn(persisted.users[0], "newPassword"), false);

  const passwordSignin = await fetch(`${base}/api/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: adminPhone, intent: "signin", password: newPassword }),
  });
  assert.equal(passwordSignin.status, 200);
  assert.equal((await passwordSignin.json()).passwordSetupRequired, undefined);
});
