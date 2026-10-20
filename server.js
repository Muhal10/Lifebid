const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const STORE_FILE = process.env.STORE_FILE || path.join(DATA_DIR, "store.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DEMO_MODE = true;
const SMS_PROVIDER = process.env.SMS_PROVIDER || "";
const AFRICASTALKING_USERNAME = process.env.AFRICASTALKING_USERNAME || "";
const AFRICASTALKING_API_KEY = process.env.AFRICASTALKING_API_KEY || "";
const AFRICASTALKING_SENDER_ID = process.env.AFRICASTALKING_SENDER_ID || "";
const SMS_PREVIEW = SMS_PROVIDER === "";
const DEMO_ADMIN_PHONE = "+251912846151";
if (SMS_PROVIDER && SMS_PROVIDER !== "africastalking") {
  console.error("Unsupported SMS_PROVIDER. Use africastalking or leave it unset for preview mode.");
  process.exit(1);
}
if (SMS_PROVIDER === "africastalking" && (!AFRICASTALKING_USERNAME || !AFRICASTALKING_API_KEY)) {
  console.error("Africa's Talking SMS is selected, but AFRICASTALKING_USERNAME or AFRICASTALKING_API_KEY is missing.");
  process.exit(1);
}
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
const scrypt = promisify(crypto.scrypt);
const MIN_PASSWORD_LENGTH = 5;

function passwordIsValid(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH && password.length <= 128;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { passwordSalt: salt, passwordHash: hash.toString("hex") };
}

async function verifyPassword(user, password) {
  if (!user.passwordSalt || !user.passwordHash || typeof password !== "string") return false;
  if (!/^[\da-f]{32}$/.test(user.passwordSalt) || !/^[\da-f]{128}$/.test(user.passwordHash)) return false;
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = await scrypt(password, user.passwordSalt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function seedStore() {
  const now = Date.now();
  const products = [
    {
      id: "phone",
      name: "Samsung Galaxy A55",
      category: "Phones",
      condition: "New",
      description: "A bright 6.6-inch display, a capable camera, and a battery that keeps up with your day.",
      delivery: "Free delivery in Addis Ababa. Other cities: ETB 350.",
      image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1000&q=85",
      imageAlt: "A smartphone resting on a warm-colored background",
      color: "peach",
    },
    {
      id: "computer",
      name: "Lenovo IdeaPad Slim 3",
      category: "Computers",
      condition: "New",
      description: "A practical everyday laptop with a comfortable keyboard and room for work, study, and a little fun.",
      delivery: "Free delivery in Addis Ababa. Other cities: ETB 500.",
      image: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1000&q=85",
      imageAlt: "An open laptop on a desk",
      color: "blue",
    },
    {
      id: "fridge",
      name: "Midea 260L Refrigerator",
      category: "Home",
      condition: "New",
      description: "A roomy, energy-conscious refrigerator with adjustable shelves and a separate freezer.",
      delivery: "Free delivery in Addis Ababa. Other cities: ETB 900.",
      image: "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=1000&q=85",
      imageAlt: "A clean, modern refrigerator in a bright kitchen",
      color: "mint",
    },
    {
      id: "stove",
      name: "Roch 4-Burner Gas Stove",
      category: "Home",
      condition: "New",
      description: "Four burners and a full-size oven make everyday meals and family gatherings easy.",
      delivery: "Free delivery in Addis Ababa. Other cities: ETB 700.",
      image: "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=1000&q=85",
      imageAlt: "A modern stove in a welcoming home kitchen",
      color: "lavender",
    },
  ];
  const closing = [2, 3, 4, 5];
  return {
    products,
    auctions: products.map((product, index) => ({
      id: `auction-${product.id}`,
      productId: product.id,
      entryFee: [45, 65, 85, 35][index],
      closesAt: new Date(now + closing[index] * 24 * 60 * 60 * 1000).toISOString(),
      status: "open",
      noUniqueRule: "earliest-lowest",
      createdAt: new Date(now).toISOString(),
      result: null,
    })),
    users: [],
    bids: [],
    payments: [],
    auditLog: [],
    policy: "If no bid amount is unique, the earliest submitted bid at the lowest bid amount wins.",
    fallbackRule: "earliest-lowest",
    recentWinners: [],
  };
}

fs.mkdirSync(DATA_DIR, { recursive: true });
let store;
try {
  store = fs.existsSync(STORE_FILE)
    ? JSON.parse(fs.readFileSync(STORE_FILE, "utf8"))
    : seedStore();
} catch (error) {
  console.error("Could not read the auction data store:", error.message);
  process.exit(1);
}
if (!fs.existsSync(STORE_FILE)) persist();

const sessions = new Map();
const challenges = new Map();
const otpRequests = new Map();

function persist() {
  const temporaryFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2));
  fs.renameSync(temporaryFile, STORE_FILE);
}

const paymentProvider = {
  async createEntryFeePayment(entryFee, bidId) {
    if (!DEMO_MODE) {
      throw new Error("A real payment provider adapter has not been configured.");
    }
    return {
      id: crypto.randomUUID(),
      bidId,
      provider: "demo",
      status: "simulated",
      amount: entryFee,
      currency: "ETB",
    };
  },
};

async function sendVerificationCode(phone, code) {
  if (SMS_PREVIEW) return;
  const sandbox = AFRICASTALKING_USERNAME === "sandbox";
  const endpoint = sandbox
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";
  const body = new URLSearchParams({
    username: AFRICASTALKING_USERNAME,
    to: phone,
    message: `Your Lifebid verification code is ${code}. It expires in 5 minutes. Do not share this code.`,
  });
  if (AFRICASTALKING_SENDER_ID) body.set("from", AFRICASTALKING_SENDER_ID);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apiKey: AFRICASTALKING_API_KEY,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("Africa's Talking SMS request failed:", error.name);
    throw new Error("We couldn’t send the verification text. Please try again.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The SMS provider returned an unreadable response. Please try again.");
  }
  const recipient = result.SMSMessageData?.Recipients?.[0];
  if (!response.ok || !recipient || recipient.status !== "Success") {
    console.error("Africa's Talking did not accept the verification SMS.", {
      httpStatus: response.status,
      providerStatus: recipient?.status || "missing",
    });
    throw new Error("The SMS provider couldn’t deliver the verification text. Please try again.");
  }
}

function recordAudit(type, details) {
  const previousHash = store.auditLog.at(-1)?.hash || "GENESIS";
  const entry = {
    id: crypto.randomUUID(),
    type,
    at: new Date().toISOString(),
    details,
    previousHash,
  };
  entry.hash = crypto.createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  store.auditLog.push(entry);
}

function safeUser(user) {
  return { id: user.id, phone: user.phone, role: user.role, firstName: user.firstName };
}

function getAuth(request) {
  const match = /^Bearer ([\w-]+)$/.exec(request.headers.authorization || "");
  if (!match) return null;
  const userId = sessions.get(match[1]);
  return store.users.find((user) => user.id === userId) || null;
}

function send(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  send(response, status, { error: message });
}

async function readJson(request, maxLength = 16_384) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maxLength) throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw Object.assign(new Error("Please check the information and try again."), { status: 400 });
  }
}

function publicAuctions() {
  const productsById = new Map(store.products.map((product) => [product.id, product]));
  return store.auctions.map((auction) => {
    const product = productsById.get(auction.productId);
    return {
      ...auction,
      product,
      participantCount: store.bids.filter((bid) => bid.auctionId === auction.id).length,
      ...(auction.status === "open" ? {} : { result: auction.result }),
    };
  }).filter((auction) => auction.product);
}

function closeAuction(auction) {
  if (auction.status !== "open" || Date.parse(auction.closesAt) > Date.now()) return;
  const bids = store.bids.filter((bid) => bid.auctionId === auction.id);
  const counts = new Map();
  for (const bid of bids) counts.set(bid.amount, (counts.get(bid.amount) || 0) + 1);

  const uniqueBids = bids.filter((bid) => counts.get(bid.amount) === 1);
  let winner = null;
  let outcome = "no-winner";
  if (uniqueBids.length) {
    winner = uniqueBids.reduce((lowest, bid) => bid.amount < lowest.amount ? bid : lowest);
    outcome = "lowest-unique";
  } else if (bids.length && auction.noUniqueRule === "earliest-lowest") {
    const lowestAmount = Math.min(...bids.map((bid) => bid.amount));
    winner = bids
      .filter((bid) => bid.amount === lowestAmount)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0];
    outcome = "earliest-lowest-tie-break";
  }

  auction.status = "closed";
  auction.result = {
    outcome,
    winnerId: winner?.userId || null,
    winningBid: winner?.amount || null,
    closedAt: new Date().toISOString(),
    policyUsed: auction.noUniqueRule,
    bidCount: bids.length,
    settlementStatus: winner ? "awaiting-confirmation" : null,
  };
  if (winner) {
    const user = store.users.find((entry) => entry.id === winner.userId);
    const product = store.products.find((entry) => entry.id === auction.productId);
    store.recentWinners.unshift({
      firstName: user?.firstName || "lifebid bidder",
      item: product?.name || "auction item",
      city: "Verified lifebid winner",
      amount: winner.amount,
      date: new Date().toLocaleDateString("en-ET", { month: "short", day: "numeric" }),
    });
    store.recentWinners = store.recentWinners.slice(0, 3);
  }
  recordAudit("auction-closed", { auctionId: auction.id, result: auction.result });
  persist();
}

function closeDueAuctions() {
  for (const auction of store.auctions) closeAuction(auction);
}

function requireUser(request, response) {
  const user = getAuth(request);
  if (!user) {
    sendError(response, 401, "Please sign in to continue.");
    return null;
  }
  return user;
}

const server = http.createServer(async (request, response) => {
  try {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    closeDueAuctions();
    return send(response, 200, {
      auctions: publicAuctions(),
      recentWinners: store.recentWinners,
      policy: store.policy,
      demoMode: DEMO_MODE,
      smsPreview: SMS_PREVIEW,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/request-code") {
    const body = await readJson(request);
    const phone = String(body.phone || "").trim();
    const intent = body.intent || "signup";
    if (!/^\+251\d{9}$/.test(phone)) {
      return sendError(response, 400, "Enter an Ethiopian mobile number, like +251911234567.");
    }
    if (!["signup", "signin"].includes(intent)) {
      return sendError(response, 400, "Choose sign up or sign in to continue.");
    }
    const existingUser = store.users.some((entry) => entry.phone === phone);
    if (intent === "signup" && existingUser) {
      return sendError(response, 409, "An account already uses this phone. Please sign in instead.");
    }
    if (intent === "signup") {
      if (!passwordIsValid(body.password)) {
        return sendError(response, 400, `Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
      if (body.password !== body.confirmPassword) {
        return sendError(response, 400, "The passwords do not match.");
      }
    }
    const user = store.users.find((entry) => entry.phone === phone);
    if (intent === "signin" && !user) {
      return sendError(response, 404, "We couldn’t find an account for this number. Please sign up first.");
    }
    let passwordSetupRequired = false;
    let signupPassword = null;
    if (intent === "signin" && user.passwordHash) {
      if (!await verifyPassword(user, body.password)) {
        return sendError(response, 401, "That phone number and password don’t match.");
      }
    } else if (intent === "signin") {
      passwordSetupRequired = true;
    } else {
      signupPassword = await hashPassword(body.password);
    }
    const rateKey = `${request.socket.remoteAddress || "unknown"}:${phone}`;
    const recentRequests = (otpRequests.get(rateKey) || []).filter((timestamp) => Date.now() - timestamp < 15 * 60 * 1000);
    if (recentRequests.length >= 3) {
      return sendError(response, 429, "Too many codes requested. Please wait 15 minutes before trying again.");
    }
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    try {
      await sendVerificationCode(phone, code);
    } catch (error) {
      return sendError(response, 502, error.message);
    }
    recentRequests.push(Date.now());
    otpRequests.set(rateKey, recentRequests);
    challenges.set(phone, {
      code,
      intent,
      attempts: 0,
      expiresAt: Date.now() + 5 * 60 * 1000,
      passwordSetupRequired,
      signupPassword,
    });
    return send(response, 200, {
      message: SMS_PREVIEW
        ? "Preview mode: use the one-time code shown here. No text message was sent."
        : "A verification code was sent to your phone.",
      ...(SMS_PREVIEW ? { previewCode: code } : {}),
      ...(passwordSetupRequired ? { passwordSetupRequired: true } : {}),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/verify") {
    const body = await readJson(request);
    const phone = String(body.phone || "").trim();
    const challenge = challenges.get(phone);
    if (!challenge || challenge.expiresAt < Date.now()) {
      challenges.delete(phone);
      return sendError(response, 400, "That code did not match or has expired. Please request a new one.");
    }
    if (String(body.code || "") !== challenge.code) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) challenges.delete(phone);
      return sendError(response, 400, "That code did not match or has expired. Please request a new one.");
    }
    let user = store.users.find((entry) => entry.phone === phone);
    const intent = body.intent || challenge.intent;
    if (intent !== challenge.intent) {
      return sendError(response, 400, "Please request a fresh verification code.");
    }
    if (intent === "signup" && user) {
      challenges.delete(phone);
      return sendError(response, 409, "An account already uses this phone. Please sign in instead.");
    }
    if (intent === "signin" && !user) {
      challenges.delete(phone);
      return sendError(response, 404, "We couldn’t find an account for this number. Please sign up first.");
    }
    let newPasswordHash = null;
    if (challenge.passwordSetupRequired) {
      if (!passwordIsValid(body.newPassword)) {
        return sendError(response, 400, `Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
      if (body.newPassword !== body.confirmPassword) {
        return sendError(response, 400, "The passwords do not match.");
      }
      newPasswordHash = await hashPassword(body.newPassword);
    }
    challenges.delete(phone);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        phone,
        role: phone === DEMO_ADMIN_PHONE ? "admin" : "user",
        firstName: phone === DEMO_ADMIN_PHONE ? "Administrator" : `Bidder ${phone.slice(-4)}`,
        createdAt: new Date().toISOString(),
        ...challenge.signupPassword,
      };
      store.users.push(user);
      recordAudit("user-created", { userId: user.id, phone });
      persist();
    } else if (newPasswordHash) {
      Object.assign(user, newPasswordHash);
      recordAudit("password-created", { userId: user.id });
      persist();
    }
    if (user.phone === DEMO_ADMIN_PHONE && user.role !== "admin") {
      user.role = "admin";
      recordAudit("administrator-role-confirmed", { userId: user.id });
      persist();
    }
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, user.id);
    return send(response, 200, { token, user: safeUser(user) });
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    const user = getAuth(request);
    return user ? send(response, 200, { user: safeUser(user) }) : sendError(response, 401, "Please sign in again.");
  }

  if (request.method === "GET" && url.pathname === "/api/user/summary") {
    const user = requireUser(request, response);
    if (!user) return;
    closeDueAuctions();
    const bids = store.bids
      .filter((bid) => bid.userId === user.id)
      .map((bid) => {
        const auction = store.auctions.find((entry) => entry.id === bid.auctionId);
        const product = store.products.find((entry) => entry.id === auction?.productId);
        return {
          ...bid,
          productName: product?.name,
          auctionStatus: auction?.status,
          result: auction?.status === "closed" ? auction.result : null,
          payment: store.payments.find((payment) => payment.bidId === bid.id),
        };
      });
    return send(response, 200, {
      bids,
      wins: bids.filter((bid) => bid.result?.winnerId === user.id),
      delivery: "Delivery is arranged after the winner confirms their contact and delivery address.",
    });
  }

  if (request.method === "POST" && url.pathname === "/api/bids") {
    const user = requireUser(request, response);
    if (!user) return;
    const body = await readJson(request);
    const auction = store.auctions.find((entry) => entry.id === body.auctionId);
    const amount = Number(body.amount);
    if (!auction) return sendError(response, 404, "We could not find that auction.");
    closeAuction(auction);
    if (auction.status !== "open" || Date.parse(auction.closesAt) <= Date.now()) {
      return sendError(response, 409, "This auction is closed, so a bid can no longer be placed.");
    }
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
      return sendError(response, 400, "Enter a whole-number bid between ETB 1 and ETB 1,000,000.");
    }
    if (store.bids.some((bid) => bid.auctionId === auction.id && bid.userId === user.id)) {
      return sendError(response, 409, "You have already placed a bid in this auction.");
    }

    let payment;
    try {
      payment = await paymentProvider.createEntryFeePayment(auction.entryFee, crypto.randomUUID());
    } catch (error) {
      console.error("Entry fee payment could not be created:", error.message);
      return sendError(response, 503, "The payment provider is not configured yet. No bid or payment was recorded.");
    }
    if (payment.status !== "simulated") {
      return sendError(response, 503, "The payment provider is not configured yet. No bid or payment was recorded.");
    }
    const bid = {
      id: crypto.randomUUID(),
      auctionId: auction.id,
      userId: user.id,
      amount,
      entryFee: auction.entryFee,
      createdAt: new Date().toISOString(),
      paymentId: payment.id,
    };
    payment.bidId = bid.id;
    store.bids.push(bid);
    store.payments.push(payment);
    recordAudit("bid-submitted", {
      bidId: bid.id,
      auctionId: auction.id,
      userId: user.id,
      amount,
      entryFee: auction.entryFee,
      paymentStatus: payment.status,
    });
    persist();
    return send(response, 201, {
      message: "Your bid is in. It is private until this auction closes.",
      bid: { id: bid.id, amount: bid.amount, createdAt: bid.createdAt },
      paymentStatus: payment.status,
    });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const user = requireUser(request, response);
    if (!user) return;
    if (user.role !== "admin") return sendError(response, 403, "Administrator access is required for this page.");
    closeDueAuctions();

    if (request.method === "GET" && url.pathname === "/api/admin/overview") {
      return send(response, 200, {
        auctions: publicAuctions(),
        products: store.products,
        bids: store.bids.map((bid) => {
          const auction = store.auctions.find((entry) => entry.id === bid.auctionId);
          const bidder = store.users.find((entry) => entry.id === bid.userId);
          const product = store.products.find((entry) => entry.id === auction?.productId);
          return {
            id: bid.id,
            auctionId: auction?.id,
            auctionStatus: auction?.status,
            productName: product?.name,
            bidder: auction?.status === "closed" ? bidder?.phone : "Private until auction closes",
            amount: auction?.status === "closed" ? bid.amount : null,
            createdAt: bid.createdAt,
          };
        }),
        auditLog: store.auditLog,
        policy: store.policy,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/policy") {
      const body = await readJson(request);
      if (!["earliest-lowest", "no-winner"].includes(body.rule)) {
        return sendError(response, 400, "Choose a published fallback rule.");
      }
      const policy = body.rule === "earliest-lowest"
        ? "If no bid amount is unique, the earliest submitted bid at the lowest bid amount wins."
        : "If no bid amount is unique, there is no winner; the item is reviewed by an administrator before it is offered again.";
      store.policy = policy;
      store.fallbackRule = body.rule;
      for (const auction of store.auctions.filter((entry) => entry.status === "open")) {
        auction.noUniqueRule = body.rule;
      }
      recordAudit("fallback-rule-updated", { rule: body.rule, policy, adminId: user.id });
      persist();
      return send(response, 200, { policy });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/settlement") {
      const body = await readJson(request);
      const auction = store.auctions.find((entry) => entry.id === body.auctionId);
      if (!auction || auction.status !== "closed" || !auction.result?.winnerId) {
        return sendError(response, 409, "Only a closed auction with a recorded winner can be settled.");
      }
      if (body.confirmed !== true) {
        return sendError(response, 400, "Confirm that the winner’s item payment was verified outside lifebid.");
      }
      auction.result.settlementStatus = "paid-offline";
      auction.result.settledAt = new Date().toISOString();
      recordAudit("offline-settlement-recorded", {
        auctionId: auction.id,
        winnerId: auction.result.winnerId,
        winningBid: auction.result.winningBid,
        adminId: user.id,
        method: "confirmed-outside",
      });
      persist();
      return send(response, 200, { result: auction.result });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/close-auction") {
      const body = await readJson(request);
      const auction = store.auctions.find((entry) => entry.id === body.auctionId);
      if (!auction || auction.status !== "open") {
        return sendError(response, 409, "Only an open auction can be closed.");
      }
      auction.closesAt = new Date().toISOString();
      closeAuction(auction);
      recordAudit("auction-closed-by-admin", { auctionId: auction.id, adminId: user.id });
      persist();
      return send(response, 200, { result: auction.result });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/auctions") {
      const body = await readJson(request, 3_000_000);
      const product = {
        id: crypto.randomUUID(),
        name: String(body.name || "").trim().slice(0, 100),
        category: String(body.category || "").trim().slice(0, 40),
        condition: String(body.condition || "").trim().slice(0, 80),
        description: String(body.description || "").trim().slice(0, 500),
        delivery: String(body.delivery || "").trim().slice(0, 200),
        image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1000&q=85",
        imageAlt: "A new auction item",
        color: "peach",
      };
      const entryFee = Number(body.entryFee);
      const closesAt = Date.parse(body.closesAt);
      if (!product.name || !product.category || !product.condition || !product.description ||
          !product.delivery || !Number.isSafeInteger(entryFee) || entryFee < 30 || entryFee > 95 ||
          !Number.isFinite(closesAt) || closesAt <= Date.now()) {
        return sendError(response, 400, "Add item details, an ETB 30–95 entry fee, and a future closing time.");
      }
      if (body.imageData !== undefined) {
        const match = typeof body.imageData === "string" &&
          /^data:image\/(jpeg|png|webp);base64,([A-Za-z\d+/]+={0,2})$/.exec(body.imageData);
        if (!match) return sendError(response, 400, "Choose a JPG, PNG, or WebP image.");
        const imageBuffer = Buffer.from(match[2], "base64");
        const validSignature = match[1] === "jpeg"
          ? imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff
          : match[1] === "png"
            ? imageBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
            : imageBuffer.subarray(0, 4).toString() === "RIFF" &&
              imageBuffer.subarray(8, 12).toString() === "WEBP";
        if (imageBuffer.length > 2 * 1024 * 1024) {
          return sendError(response, 413, "Choose an image smaller than 2 MB.");
        }
        if (!imageBuffer.length || imageBuffer.toString("base64") !== match[2] || !validSignature) {
          return sendError(response, 400, "That image file could not be read. Choose a JPG, PNG, or WebP image.");
        }
        const extension = match[1] === "jpeg" ? "jpg" : match[1];
        const filename = `${crypto.randomUUID()}.${extension}`;
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), imageBuffer, { flag: "wx" });
        product.image = `/uploads/${filename}`;
        product.imageAlt = product.name;
      }
      const auction = {
        id: `auction-${crypto.randomUUID()}`,
        productId: product.id,
        entryFee,
        closesAt: new Date(closesAt).toISOString(),
        status: "open",
        noUniqueRule: store.fallbackRule || "earliest-lowest",
        createdAt: new Date().toISOString(),
        result: null,
      };
      store.products.push(product);
      store.auctions.push(auction);
      recordAudit("auction-created", { auctionId: auction.id, productId: product.id, adminId: user.id });
      persist();
      return send(response, 201, { auction });
    }
    return sendError(response, 404, "That admin action is not available.");
  }

  if (request.method === "GET") {
    const uploadedImage = /^\/uploads\/([a-f\d-]+\.(?:jpg|png|webp))$/i.exec(url.pathname);
    if (uploadedImage) {
      const file = path.join(UPLOAD_DIR, uploadedImage[1]);
      if (!fs.existsSync(file)) {
        response.writeHead(404);
        return response.end("Not found");
      }
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(file)],
        "Content-Length": fs.statSync(file).size,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      return fs.createReadStream(file).pipe(response);
    }
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const allowed = new Set(["/index.html", "/styles.css", "/app.js"]);
    if (!allowed.has(requestedPath)) {
      response.writeHead(404);
      return response.end("Not found");
    }
    const file = path.join(ROOT, "public", requestedPath.slice(1));
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(file)],
      "Cache-Control": "no-cache",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    return fs.createReadStream(file).pipe(response);
  }

  return sendError(response, 404, "That page is not available.");
  } catch (error) {
    if (error.status) return sendError(response, error.status, error.message);
    console.error("Request failed:", error);
    return sendError(response, 500, "We couldn’t complete that request. Please try again.");
  }
});

const closeTimer = setInterval(closeDueAuctions, 1000);
closeTimer.unref();

server.listen(PORT, () => {
  console.log(`lifebid preview is running at http://localhost:${PORT}`);
  console.log(SMS_PREVIEW
    ? "Phone verification preview is enabled — no SMS will be sent."
    : `Phone verification uses Africa's Talking (${AFRICASTALKING_USERNAME === "sandbox" ? "sandbox" : "production"}).`);
  if (DEMO_MODE) console.log("Preview payments are simulated — no real payment provider is configured.");
});
