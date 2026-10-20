const state = {
  auctions: [],
  winners: [],
  policy: "",
  demoMode: true,
  smsPreview: true,
  token: localStorage.getItem("lifebid-token"),
  user: null,
  category: "All",
  activeAuction: null,
  toastTimer: null,
};

const grid = document.querySelector("#auction-grid");
const backdrop = document.querySelector("#modal-backdrop");
const modal = document.querySelector("#modal-card");
const toast = document.querySelector("#toast");
const formatter = new Intl.NumberFormat("en-ET");
const money = (amount) => `ETB ${formatter.format(amount)}`;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401 && state.token) signOut(false);
    throw new Error(payload.error || "Something went wrong. Please try again.");
  }
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3400);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function timeLeft(closesAt) {
  const diff = Math.max(0, Date.parse(closesAt) - Date.now());
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (!diff) return "Closed";
  return days ? `${days}d ${hours}h` : `${hours}h left`;
}

function renderAuctions() {
  const visible = state.auctions.filter((auction) =>
    auction.status === "open" && (state.category === "All" || auction.product.category === state.category));
  document.querySelector("#auction-count").textContent = `${visible.length} auction${visible.length === 1 ? "" : "s"}`;
  document.querySelector("#count-all").textContent = state.auctions.filter((auction) => auction.status === "open").length;
  if (!visible.length) {
    grid.innerHTML = '<div class="empty-state">No open auctions in this category just now. Try another one.</div>';
    return;
  }
  grid.innerHTML = visible.map((auction) => `
    <article class="auction-card" data-auction="${escapeHtml(auction.id)}" tabindex="0" aria-label="View ${escapeHtml(auction.product.name)} auction details">
      <div class="card-image-wrap"><img src="${escapeHtml(auction.product.image)}" alt="${escapeHtml(auction.product.imageAlt)}" loading="lazy"><span class="condition-pill">${escapeHtml(auction.product.condition)}</span><button class="save-button" data-save="${escapeHtml(auction.id)}" aria-label="Save ${escapeHtml(auction.product.name)} to your favourites">♡</button></div>
      <div class="card-body"><div class="card-category">${escapeHtml(auction.product.category)}</div><h3 class="card-title">${escapeHtml(auction.product.name)}</h3>
        <div class="card-meta"><div><small>Entry fee</small><strong class="card-fee">${money(auction.entryFee)}</strong></div><div><small>Closes in</small><strong>${timeLeft(auction.closesAt)}</strong></div></div>
        <div class="card-bottom"><span class="card-participants">${auction.participantCount} bidder${auction.participantCount === 1 ? "" : "s"}</span><span class="card-cta">Take a look <span>↗</span></span></div>
      </div>
    </article>`).join("");
}

function renderWinners() {
  const winnerGrid = document.querySelector("#winner-grid");
  winnerGrid.innerHTML = state.winners.map((winner) => `
    <article class="winner-card"><span class="winner-avatar">${escapeHtml(winner.firstName[0])}</span><div class="winner-info"><strong>${escapeHtml(winner.firstName)} found a ${escapeHtml(winner.item)}</strong><p>${escapeHtml(winner.city)} · ${escapeHtml(winner.date)}</p></div><div class="winner-win">A little win!<small>${money(winner.amount)}</small></div></article>`).join("") || '<div class="empty-state">Our first verified winners will be celebrated here after an auction closes.</div>';
}

function openModal(content) {
  modal.innerHTML = `<button class="modal-close" aria-label="Close dialog">×</button>${content}`;
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  modal.querySelector(".modal-close").focus();
}

function closeModal() {
  backdrop.hidden = true;
  document.body.style.overflow = "";
}

function auctionDetail(auction) {
  state.activeAuction = auction;
  openModal(`
    <div class="detail-layout">
      <div><img class="detail-image" src="${escapeHtml(auction.product.image)}" alt="${escapeHtml(auction.product.imageAlt)}"><div class="modal-kicker">${escapeHtml(auction.product.category)} · ${escapeHtml(auction.product.condition)}</div><h2 id="modal-title">${escapeHtml(auction.product.name)}</h2><p>${escapeHtml(auction.product.description)}</p><div class="detail-specs"><div class="detail-spec"><small>Entry fee</small><strong>${money(auction.entryFee)}</strong></div><div class="detail-spec"><small>Closes</small><strong>${new Date(auction.closesAt).toLocaleString("en-ET", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })} EAT</strong></div><div class="detail-spec"><small>Condition</small><strong>${escapeHtml(auction.product.condition)}</strong></div><div class="detail-spec"><small>Delivery</small><strong>${escapeHtml(auction.product.delivery)}</strong></div></div>
        <div class="rule-box"><strong>How this one works</strong><p>Your bid is private until closing. The lowest amount entered by exactly one person wins. The winner pays their bid separately; the entry fee is not the item price.</p></div>
        <div class="rule-box"><strong>If no bid amount is unique</strong><p>${escapeHtml(state.policy)} Entry fees are separate and are not refundable in this preview.</p></div>
      </div>
      <div><div class="modal-kicker">A FEW IMPORTANT DETAILS</div><h2>Know before you bid.</h2><p>Entry fee: <strong>${money(auction.entryFee)}</strong>. Your bid amount is separate. This preview simulates the fee; no money is taken.</p><p>Winner pays their bid amount for the item. Delivery: ${escapeHtml(auction.product.delivery)}</p><p>Closing time: ${new Date(auction.closesAt).toLocaleString("en-ET", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })} EAT.</p>
        <form class="bid-form" id="bid-form"><label for="bid-amount">Your private bid (ETB)</label><input id="bid-amount" type="number" min="1" max="1000000" step="1" placeholder="For example, 120" required><p class="form-hint">Choose a whole number from ETB 1 to ETB 1,000,000. Other bidders won't see it until this auction closes.</p><button class="button button-primary full-width" type="submit">Place my bid <span>↗</span></button><p class="form-hint">No pressure, and no real charge in this preview.</p></form>
      </div>
    </div>`);
  modal.querySelector("#bid-form").addEventListener("submit", submitBid);
}

async function submitBid(event) {
  event.preventDefault();
  if (!state.user) {
    showAuth("signin", true);
    return;
  }
  const amount = Number(modal.querySelector("#bid-amount").value);
  const button = modal.querySelector("#bid-form button[type=submit]");
  button.disabled = true;
  button.textContent = "Placing your bid...";
  try {
    await api("/api/bids", {
      method: "POST",
      body: JSON.stringify({ auctionId: state.activeAuction.id, amount }),
    });
    closeModal();
    showToast("Your bid is in. It stays private until the auction closes.");
    await loadBootstrap();
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.innerHTML = 'Place my bid <span>↗</span>';
  }
}

function showAuth(mode = "signin", returnToBid = false) {
  const passwordFields = mode === "signup"
    ? `<label for="password">Create password</label><input id="password" type="password" autocomplete="new-password" minlength="5" maxlength="128" required><p class="form-hint">Use at least 5 characters.</p><label for="confirm-password">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" minlength="5" maxlength="128" required>`
    : `<label for="password">Password</label><input id="password" type="password" autocomplete="current-password" maxlength="128"><p class="form-hint">Enter your password. If your account needs a password update, you can set one after phone verification.</p>`;
  openModal(`<div class="auth-content"><div class="auth-icon">✳</div><div class="modal-kicker">${mode === "signup" ? "MAKE YOUR LIFEBID ACCOUNT" : "WELCOME BACK"}</div><h2 id="modal-title">${mode === "signup" ? "Join the good stuff." : "Let’s get you in."}</h2><p>${mode === "signup" ? "Create an account with your Ethiopian phone number and a password. We’ll verify your phone before you can bid." : "Sign in with your Ethiopian phone number and password. We’ll also verify your phone."}</p><div class="notice demo-notice">${state.smsPreview ? "Preview mode: no SMS is sent. Your one-time verification code will appear after you request it." : "A one-time code will be sent to your phone."}</div><form class="auth-form" id="auth-form" data-intent="${mode}"><label for="phone">Phone number</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+251 911 234 567" pattern="\\+251[0-9]{9}" required>${passwordFields}<button class="button button-dark full-width" type="submit">${mode === "signup" ? "Create account" : "Sign in"} <span>↗</span></button></form><p class="form-hint">${mode === "signup" ? 'Already have an account? <button class="text-button" type="button" id="switch-auth">Sign in</button>' : 'New to Lifebid? <button class="text-button" type="button" id="switch-auth">Create an account</button>'}</p></div>`);
  modal.querySelector("#auth-form").addEventListener("submit", (event) => requestCode(event, returnToBid));
  modal.querySelector("#switch-auth").addEventListener("click", () => showAuth(mode === "signup" ? "signin" : "signup", returnToBid));
}

async function requestCode(event, returnToBid) {
  event.preventDefault();
  const form = event.currentTarget;
  const phone = form.querySelector("#phone").value.replaceAll(" ", "");
  const intent = form.dataset.intent;
  const credentials = {
    password: form.querySelector("#password").value,
    ...(intent === "signup" ? { confirmPassword: form.querySelector("#confirm-password").value } : {}),
  };
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const result = await api("/api/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ phone, intent, ...credentials }),
    });
    verificationForm(phone, result.previewCode, returnToBid, intent, credentials, result.passwordSetupRequired);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

function verificationForm(phone, code, returnToBid, intent, credentials, passwordSetupRequired = false) {
  const setupPasswordFields = passwordSetupRequired
    ? `<div class="notice">This account needs a password before you can sign in. Choose one now.</div><label for="new-password">Create password</label><input id="new-password" type="password" autocomplete="new-password" minlength="5" maxlength="128" required><label for="confirm-password">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" minlength="5" maxlength="128" required>`
    : "";
  openModal(`<div class="auth-content"><div class="auth-icon">✓</div><div class="modal-kicker">${intent === "signup" ? "VERIFY YOUR NEW ACCOUNT" : "SIGN IN SECURELY"}</div><h2 id="modal-title">Check your phone.</h2><p>Enter the six-digit code to ${intent === "signup" ? "create your account for" : "sign in as"} <strong>${escapeHtml(phone)}</strong>.</p><div class="notice" id="verification-notice">${state.smsPreview ? `Preview verification code: <strong>${escapeHtml(code || "Unavailable")}</strong>. No SMS was sent.` : "A verification code was sent to your phone. It expires in five minutes."}</div><form class="auth-form" id="verify-form"><label for="code">Phone verification code</label><input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="Six-digit code" required>${setupPasswordFields}<button class="button button-dark full-width" type="submit">${intent === "signup" ? "Verify and create account" : "Verify and sign in"} <span>↗</span></button></form><button class="text-button full-width" type="button" id="resend-code">Send a new code</button></div>`);
  modal.querySelector("#resend-code").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ phone, intent, ...credentials }),
      });
      verificationForm(phone, result.previewCode, returnToBid, intent, credentials, result.passwordSetupRequired);
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  modal.querySelector("#verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const result = await api("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          phone,
          code: modal.querySelector("#code").value,
          intent,
          ...(passwordSetupRequired ? {
            newPassword: modal.querySelector("#new-password").value,
            confirmPassword: modal.querySelector("#confirm-password").value,
          } : {}),
        }),
      });
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem("lifebid-token", result.token);
      syncHeader();
      closeModal();
      showToast(intent === "signup" ? `Your account is ready, ${result.user.firstName}. Lovely to have you here.` : `Welcome back, ${result.user.firstName}.`);
      if (returnToBid && state.activeAuction) auctionDetail(state.activeAuction);
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
}

function syncHeader() {
  document.querySelector("#signin-button").hidden = !!state.user;
  document.querySelector("#signup-button").hidden = !!state.user;
  document.querySelector("#dashboard-button").hidden = !state.user;
  if (state.user) document.querySelector("#dashboard-button").textContent = state.user.role === "admin" ? "Admin desk" : "My lifebid";
}

function signOut(showMessage = true) {
  localStorage.removeItem("lifebid-token");
  state.token = null;
  state.user = null;
  syncHeader();
  if (showMessage) showToast("You’re signed out. Come back any time.");
}

async function showDashboard() {
  if (!state.user) return showAuth();
  if (state.user.role === "admin") return showAdmin();
  try {
    const summary = await api("/api/user/summary");
    openModal(`<div class="admin-heading"><div><div class="modal-kicker">YOUR LIFEBID</div><h2 id="modal-title">Hello, ${escapeHtml(state.user.firstName)}.</h2></div><button class="text-button" id="signout-inline">Sign out</button></div><div class="modal-tabs"><button class="active" data-tab="bids">My bids & results</button></div>${summary.bids.length ? summary.bids.map((bid) => `<div class="dashboard-row"><div><strong>${escapeHtml(bid.productName)}</strong><small>Your private bid: ${money(bid.amount)} · Entry fee: ${money(bid.entryFee)} (${escapeHtml(bid.payment?.status === "simulated" ? "simulated payment" : bid.payment?.status || "payment")})</small>${bid.auctionStatus === "closed" && bid.result?.winnerId === state.user.id ? `<small>${bid.result.settlementStatus === "paid-offline" ? "Your item payment was confirmed by an administrator." : `You won! The item balance is ${money(bid.amount)}; payment is arranged outside this preview.`}</small>` : ""}${bid.auctionStatus === "open" ? "<small>Your bid is private until the auction closes.</small>" : ""}</div><span class="status-pill ${bid.auctionStatus === "closed" ? "closed" : ""}">${bid.auctionStatus === "closed" ? (bid.result?.winnerId === state.user.id ? "You won!" : "Closed") : "Open"}</span></div>`).join("") : '<div class="empty-state">No bids just yet. Take a look around when you’re ready.</div>'}<p class="form-hint">${escapeHtml(summary.delivery)} A real delivery service needs to be arranged before launch.</p>`)
    modal.querySelector("#signout-inline").addEventListener("click", () => { closeModal(); signOut(); });
  } catch (error) {
    showToast(error.message);
  }
}

async function showAdmin() {
  try {
    const overview = await api("/api/admin/overview");
    openModal(`<div class="admin-heading"><div><div class="modal-kicker">ADMINISTRATOR</div><h2 id="modal-title">The admin desk.</h2></div><button class="text-button" id="signout-inline">Sign out</button></div><div class="notice demo-notice">Preview workspace. Live bids stay hidden from this view until their auction closes.</div><div class="modal-tabs"><button class="active" data-admin-tab="auctions">Auctions & bids</button><button data-admin-tab="create">Add an auction</button><button data-admin-tab="policy">Tie-break rule</button></div><div id="admin-panel"></div>`);
    modal.querySelector("#signout-inline").addEventListener("click", () => { closeModal(); signOut(); });
    modal.querySelectorAll("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => {
      modal.querySelectorAll("[data-admin-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
      if (button.dataset.adminTab === "auctions") renderAdminAuctions(overview);
      if (button.dataset.adminTab === "create") renderAdminCreate();
      if (button.dataset.adminTab === "policy") renderAdminPolicy(overview);
    }));
    renderAdminAuctions(overview);
  } catch (error) {
    showToast(error.message);
  }
}

function renderAdminAuctions(overview) {
  const panel = modal.querySelector("#admin-panel");
  const open = overview.auctions.filter((auction) => auction.status === "open").length;
  const closed = overview.auctions.filter((auction) => auction.status === "closed").length;
  panel.innerHTML = `<p class="form-hint">${open} open auctions · ${closed} closed · ${overview.auditLog.length} audit records. Bids and bidder details appear here only after closing.</p>${overview.auctions.map((auction) => `<div class="dashboard-row"><div><strong>${escapeHtml(auction.product.name)}</strong><small>Entry fee ${money(auction.entryFee)} · ${auction.status === "open" ? `${auction.participantCount} private bids` : `${auction.result?.bidCount || 0} bids reviewed`}</small>${auction.status === "open" ? `<button class="text-button" data-close-auction="${escapeHtml(auction.id)}">Close auction now</button>` : `<small>Result: ${auction.result?.winnerId ? `${money(auction.result.winningBid)} · ${escapeHtml(auction.result.outcome)}` : "No winner"}${auction.result?.winnerId ? ` · ${escapeHtml(auction.result.settlementStatus || "awaiting-confirmation")}` : ""}</small>${auction.result?.winnerId && auction.result.settlementStatus !== "paid-offline" ? `<button class="text-button" data-settle="${escapeHtml(auction.id)}">Record off-platform payment</button>` : ""}`}</div><span class="status-pill ${auction.status === "closed" ? "closed" : ""}">${auction.status === "open" ? "Open" : "Closed"}</span></div>`).join("")}<details style="margin-top:16px"><summary style="font-size:11px;cursor:pointer">Closed bid review & audit trail</summary>${overview.bids.filter((bid) => bid.auctionStatus === "closed").map((bid) => `<div class="dashboard-row"><div><strong>${escapeHtml(bid.productName)} · ${money(bid.amount)}</strong><small>${escapeHtml(bid.bidder)} · ${new Date(bid.createdAt).toLocaleString()}</small></div></div>`).join("") || '<p class="form-hint">No closed bids to review yet.</p>'}<p class="form-hint">Audit entries are hash-linked in the local data file. A production deployment needs protected, backed-up audit storage.</p></details>`;
  panel.querySelectorAll("[data-close-auction]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Close this auction now? Bids will be compared and the result will be recorded.")) return;
    try {
      await api("/api/admin/close-auction", {
        method: "POST",
        body: JSON.stringify({ auctionId: button.dataset.closeAuction }),
      });
      showToast("Auction closed and the result is recorded.");
      await showAdmin();
    } catch (error) {
      showToast(error.message);
    }
  }));
  panel.querySelectorAll("[data-settle]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Confirm that the winner’s item payment was verified outside lifebid. This records an admin note only; it does not process money.")) return;
    try {
      await api("/api/admin/settlement", {
        method: "POST",
        body: JSON.stringify({ auctionId: button.dataset.settle, confirmed: true }),
      });
      showToast("Off-platform settlement note recorded.");
      await showAdmin();
    } catch (error) {
      showToast(error.message);
    }
  }));
}

function renderAdminCreate() {
  const panel = modal.querySelector("#admin-panel");
  panel.innerHTML = `<form class="admin-form" id="create-auction-form"><div class="span-two"><label for="new-name">Item name</label><input id="new-name" name="name" required maxlength="100" placeholder="For example, a new laptop"></div><div><label for="new-category">Category</label><select id="new-category" name="category"><option>Phones</option><option>Computers</option><option>Home</option></select></div><div><label for="new-condition">Condition</label><input id="new-condition" name="condition" value="New" required></div><div class="span-two"><label for="new-image">Item picture (optional)</label><input id="new-image" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="new-image-hint"><p id="new-image-hint" class="form-hint">Choose a JPG, PNG, or WebP photo up to 2 MB.</p><img id="new-image-preview" class="image-upload-preview" alt="Selected item photo preview" hidden></div><div class="span-two"><label for="new-description">Item details</label><textarea id="new-description" name="description" required placeholder="What should bidders know?"></textarea></div><div class="span-two"><label for="new-delivery">Delivery details</label><input id="new-delivery" name="delivery" required placeholder="Cost and delivery areas"></div><div><label for="new-fee">Entry fee (ETB 30–95)</label><input id="new-fee" name="entryFee" type="number" min="30" max="95" step="1" required value="45"></div><div><label for="new-closing">Closing date and time</label><input id="new-closing" name="closesAt" type="datetime-local" required></div><div class="span-two"><button class="button button-primary full-width" type="submit">Add auction</button></div></form>`;
  const defaultClose = new Date(Date.now() + 3 * 86_400_000);
  defaultClose.setMinutes(defaultClose.getMinutes() - defaultClose.getTimezoneOffset());
  panel.querySelector("#new-closing").value = defaultClose.toISOString().slice(0, 16);
  const formElement = panel.querySelector("#create-auction-form");
  const imageInput = panel.querySelector("#new-image");
  const preview = panel.querySelector("#new-image-preview");
  let previewUrl = null;
  imageInput.addEventListener("change", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    const file = imageInput.files[0];
    if (!file) {
      preview.hidden = true;
      preview.removeAttribute("src");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      imageInput.value = "";
      preview.hidden = true;
      preview.removeAttribute("src");
      showToast("Choose a JPG, PNG, or WebP image smaller than 2 MB.");
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
  });
  formElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(formElement);
    const data = Object.fromEntries(form.entries());
    const imageFile = imageInput.files[0];
    delete data.image;
    data.closesAt = new Date(data.closesAt).toISOString();
    try {
      if (imageFile) {
        data.imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(reader.result));
          reader.addEventListener("error", () => reject(new Error("We couldn’t read that image. Please choose it again.")));
          reader.readAsDataURL(imageFile);
        });
      }
      await api("/api/admin/auctions", { method: "POST", body: JSON.stringify(data) });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      showToast("Your auction is live.");
      await loadBootstrap();
      await showAdmin();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function renderAdminPolicy(overview) {
  const panel = modal.querySelector("#admin-panel");
  panel.innerHTML = `<p class="form-hint">Every auction publishes its tie-break rule before anyone bids. The rule is saved in the audit trail.</p><div class="notice">Current published rule: ${escapeHtml(overview.policy)}</div><form id="policy-form"><label for="fallback-rule" style="font-size:11px;font-weight:700;display:block;margin-bottom:8px">When no amount is unique</label><select id="fallback-rule" style="width:100%;padding:12px;border-radius:7px;border:1px solid #deded5"><option value="earliest-lowest" ${overview.policy.includes("earliest submitted") ? "selected" : ""}>Earliest bid at the lowest amount wins</option><option value="no-winner" ${overview.policy.includes("there is no winner") ? "selected" : ""}>No winner; admin reviews the item</option></select><button class="button button-dark full-width" style="margin-top:13px" type="submit">Save and publish rule</button></form>`;
  panel.querySelector("#policy-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/policy", { method: "POST", body: JSON.stringify({ rule: panel.querySelector("#fallback-rule").value }) });
      showToast("The rule is saved and published for open auctions.");
      await showAdmin();
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  state.auctions = data.auctions;
  state.winners = data.recentWinners;
  state.policy = data.policy;
  state.demoMode = data.demoMode;
  state.smsPreview = data.smsPreview;
  renderAuctions();
  renderWinners();
}

document.querySelector("#category-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
  renderAuctions();
});

grid.addEventListener("click", (event) => {
  if (event.target.closest("[data-save]")) {
    const button = event.target.closest("[data-save]");
    button.classList.toggle("saved");
    button.textContent = button.classList.contains("saved") ? "♥" : "♡";
    showToast(button.classList.contains("saved") ? "Saved for later on this device." : "Removed from your saved items.");
    return;
  }
  const card = event.target.closest("[data-auction]");
  if (card) {
    const auction = state.auctions.find((entry) => entry.id === card.dataset.auction);
    if (auction) auctionDetail(auction);
  }
});
grid.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-auction]")) {
    event.preventDefault();
    const auction = state.auctions.find((entry) => entry.id === event.target.dataset.auction);
    if (auction) auctionDetail(auction);
  }
});
modal.addEventListener("click", (event) => {
  if (event.target.closest(".modal-close")) closeModal();
});
backdrop.addEventListener("click", (event) => {
  if (event.target === backdrop) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !backdrop.hidden) closeModal();
});
document.querySelector("#signin-button").addEventListener("click", () => showAuth());
document.querySelector("#signup-button").addEventListener("click", () => showAuth("signup"));
document.querySelector("#dashboard-button").addEventListener("click", showDashboard);
document.querySelector("#mobile-menu").addEventListener("click", () => document.querySelector(".main-nav").classList.toggle("open"));
document.querySelectorAll(".main-nav a").forEach((link) => link.addEventListener("click", () => document.querySelector(".main-nav").classList.remove("open")));

async function start() {
  try {
    await loadBootstrap();
    if (state.token) {
      try {
        const result = await api("/api/me");
        state.user = result.user;
      } catch {
        signOut(false);
      }
    }
    syncHeader();
  } catch (error) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)} Refresh to try again.</div>`;
  }
}

start();
