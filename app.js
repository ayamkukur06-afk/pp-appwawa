import { supabase, BUCKET_MEDIA, BUCKET_STICKERS } from "./supabaseClient.js";

/* =========================================================
   STATE
========================================================= */
const state = {
  me: null,            // { id, username, avatar_url, about }
  chats: [],           // daftar chat + info lawan bicara + pesan terakhir
  activeChatId: null,
  activePeer: null,
  activeTab: "chats",
  messagesChannel: null,
  stickers: [],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* =========================================================
   HELPERS UMUM
========================================================= */
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

function initials(name) {
  if (!name) return "?";
  return name.trim().slice(0, 2).toUpperCase();
}

function fillAvatarNode(node, profile) {
  node.textContent = "";
  if (profile?.avatar_url) {
    node.style.backgroundImage = `url(${profile.avatar_url})`;
    node.style.backgroundSize = "cover";
    node.style.backgroundPosition = "center";
  } else {
    node.style.backgroundImage = "";
    node.textContent = initials(profile?.username);
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function formatDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Hari ini";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}
function fileSizeLabel(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }

/* =========================================================
   LOGIN / PROFIL
========================================================= */
async function init() {
  applyStoredTheme();
  const savedId = localStorage.getItem("chatly_profile_id");
  if (savedId) {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", savedId).single();
    if (data && !error) {
      state.me = data;
      await enterApp();
      return;
    }
    localStorage.removeItem("chatly_profile_id");
  }
  showLogin();
}

function showLogin() {
  $("#screen-login").classList.add("active");
  $("#screen-app").classList.remove("active");
  $("#usernameInput").focus();
}

async function handleStart() {
  const username = $("#usernameInput").value.trim();
  const errorEl = $("#loginError");
  errorEl.classList.add("hidden");
  if (!username) {
    errorEl.textContent = "Nama panggilan tidak boleh kosong.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (!/^[a-zA-Z0-9_. ]{2,24}$/.test(username)) {
    errorEl.textContent = "Gunakan huruf, angka, spasi, titik, atau underscore (2-24 karakter).";
    errorEl.classList.remove("hidden");
    return;
  }

  $("#startBtn").disabled = true;
  $("#startBtn").textContent = "Memuat...";

  try {
    let { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .ilike("username", username)
      .maybeSingle();

    if (!existing) {
      const { data: created, error } = await supabase
        .from("profiles")
        .insert({ username })
        .select()
        .single();
      if (error) throw error;
      existing = created;
    }

    state.me = existing;
    localStorage.setItem("chatly_profile_id", existing.id);
    await supabase.from("profiles").update({ is_online: true, last_seen: new Date().toISOString() }).eq("id", existing.id);
    await enterApp();
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Username sudah dipakai atau terjadi kesalahan. Coba nama lain.";
    errorEl.classList.remove("hidden");
  } finally {
    $("#startBtn").disabled = false;
    $("#startBtn").textContent = "Mulai Chat";
  }
}

async function enterApp() {
  $("#screen-login").classList.remove("active");
  $("#screen-app").classList.add("active");

  fillAvatarNode($("#myAvatarFallback"), state.me);
  if (state.me.avatar_url) {
    $("#myAvatarImg").src = state.me.avatar_url;
    $("#myAvatarImg").style.display = "block";
  }

  await loadChats();
  subscribeToInbox();
  subscribeToPresence();
}

function logout() {
  if (state.me) {
    supabase.from("profiles").update({ is_online: false, last_seen: new Date().toISOString() }).eq("id", state.me.id);
  }
  localStorage.removeItem("chatly_profile_id");
  state.me = null;
  state.activeChatId = null;
  location.reload();
}

/* =========================================================
   TEMA (gelap/terang)
========================================================= */
function applyStoredTheme() {
  const theme = localStorage.getItem("chatly_theme") || "dark";
  document.body.classList.toggle("light", theme === "light");
}
function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  localStorage.setItem("chatly_theme", isLight ? "light" : "dark");
}

/* =========================================================
   TAB NAVIGASI (Chat / Komunitas / Pembaruan)
========================================================= */
function switchTab(tab) {
  state.activeTab = tab;
  $$(".nav-icon[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));

  $("#chatListView").classList.toggle("hidden", tab !== "chats");
  $("#updatesListView").classList.toggle("hidden", tab !== "updates");
  $("#communitiesListView").classList.toggle("hidden", tab !== "communities");

  const titles = { chats: "Chat", updates: "Pembaruan", communities: "Komunitas" };
  $("#listTitle").textContent = titles[tab];
  $("#composeBtn").classList.toggle("hidden", tab === "communities");
  $("#searchInput").placeholder = tab === "updates" ? "Cari pembaruan" : "Cari nama pengguna atau mulai chat baru";

  if (tab === "updates") loadStatuses();
}

/* =========================================================
   DAFTAR CHAT
========================================================= */
async function loadChats() {
  const { data: parts, error } = await supabase
    .from("chat_participants")
    .select("chat_id")
    .eq("profile_id", state.me.id);
  if (error) { console.error(error); return; }

  const chatIds = parts.map((p) => p.chat_id);
  if (chatIds.length === 0) { state.chats = []; renderChatList(); return; }

  const { data: allParts } = await supabase
    .from("chat_participants")
    .select("chat_id, profile_id, profiles(*)")
    .in("chat_id", chatIds);

  const { data: lastMessages } = await supabase
    .from("messages")
    .select("*")
    .in("chat_id", chatIds)
    .order("created_at", { ascending: false });

  state.chats = chatIds.map((chatId) => {
    const peerRow = allParts.find((p) => p.chat_id === chatId && p.profile_id !== state.me.id);
    const lastMsg = lastMessages?.find((m) => m.chat_id === chatId);
    return {
      chatId,
      peer: peerRow?.profiles || null,
      lastMessage: lastMsg || null,
    };
  }).sort((a, b) => {
    const ta = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
    return tb - ta;
  });

  renderChatList();
}

function previewForMessage(m) {
  if (!m) return "Belum ada pesan";
  if (m.type === "image") return "📷 Foto";
  if (m.type === "file") return "📄 " + (m.file_name || "Dokumen");
  if (m.type === "sticker") return "🖼️ Stiker";
  return m.content || "";
}

function renderChatList(filter = "") {
  const container = $("#chatListView");
  container.innerHTML = "";
  const f = filter.trim().toLowerCase();
  const rows = state.chats.filter((c) => !f || c.peer?.username?.toLowerCase().includes(f));

  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-inline"><p>${f ? "Tidak ada hasil." : "Belum ada chat. Tekan tombol pensil untuk mulai chat baru."}</p></div>`;
    return;
  }

  rows.forEach((row) => {
    const div = document.createElement("div");
    div.className = "chat-row" + (row.chatId === state.activeChatId ? " active" : "");
    const avatar = document.createElement("div");
    avatar.className = "avatar-fallback";
    fillAvatarNode(avatar, row.peer);

    div.innerHTML = `<div class="row-text">
        <strong>${escapeHtml(row.peer?.username || "Pengguna")}</strong>
        <span>${escapeHtml(previewForMessage(row.lastMessage))}</span>
      </div>
      <span class="row-meta">${row.lastMessage ? formatTime(row.lastMessage.created_at) : ""}</span>`;
    div.prepend(avatar);
    div.addEventListener("click", () => openChat(row.chatId, row.peer));
    container.appendChild(div);
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

/* =========================================================
   CHAT BARU (cari username lain)
========================================================= */
async function searchUsers(term) {
  const box = $("#newChatResults");
  if (!term.trim()) { box.innerHTML = ""; return; }
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", `%${term.trim()}%`)
    .neq("id", state.me.id)
    .limit(15);
  if (error) { console.error(error); return; }

  box.innerHTML = "";
  if (!data.length) {
    box.innerHTML = `<div class="empty-inline"><p>Tidak ditemukan pengguna dengan nama itu.</p></div>`;
    return;
  }
  data.forEach((u) => {
    const div = document.createElement("div");
    div.className = "result-row";
    const avatar = document.createElement("div");
    avatar.className = "avatar-fallback";
    fillAvatarNode(avatar, u);
    div.innerHTML = `<div class="row-text"><strong>${escapeHtml(u.username)}</strong><span>${escapeHtml(u.about || "")}</span></div>`;
    div.prepend(avatar);
    div.addEventListener("click", async () => {
      closeModal("newChatModal");
      const chatId = await getOrCreateChat(u.id);
      await loadChats();
      openChat(chatId, u);
    });
    box.appendChild(div);
  });
}

async function getOrCreateChat(peerId) {
  const { data: mine } = await supabase.from("chat_participants").select("chat_id").eq("profile_id", state.me.id);
  const { data: theirs } = await supabase.from("chat_participants").select("chat_id").eq("profile_id", peerId);
  const mineIds = new Set((mine || []).map((r) => r.chat_id));
  const common = (theirs || []).map((r) => r.chat_id).find((id) => mineIds.has(id));
  if (common) return common;

  const { data: chat, error } = await supabase.from("chats").insert({ is_group: false, created_by: state.me.id }).select().single();
  if (error) { toast("Gagal membuat chat"); throw error; }

  await supabase.from("chat_participants").insert([
    { chat_id: chat.id, profile_id: state.me.id },
    { chat_id: chat.id, profile_id: peerId },
  ]);
  return chat.id;
}

/* =========================================================
   BUKA & RENDER SATU CHAT
========================================================= */
async function openChat(chatId, peer) {
  state.activeChatId = chatId;
  state.activePeer = peer;

  $("#chatEmpty").classList.add("hidden");
  $("#chatActive").classList.remove("hidden");
  $("#peerName").textContent = peer?.username || "Pengguna";
  $("#peerStatus").textContent = peer?.is_online ? "online" : "offline";
  fillAvatarNode($("#peerAvatar"), peer);

  renderChatList($("#searchInput").value);

  const { data: msgs, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return; }

  renderMessages(msgs || []);
  listenToChat(chatId);
  loadMyStickers();
}

function renderMessages(msgs) {
  const container = $("#messagesContainer");
  container.innerHTML = "";
  let lastDay = null;
  msgs.forEach((m) => {
    const day = formatDay(m.created_at);
    if (day !== lastDay) {
      const div = document.createElement("div");
      div.className = "day-divider";
      div.textContent = day;
      container.appendChild(div);
      lastDay = day;
    }
    container.appendChild(renderMessageNode(m));
  });
  container.scrollTop = container.scrollHeight;
}

function renderMessageNode(m) {
  const row = document.createElement("div");
  const out = m.sender_id === state.me.id;
  row.className = "msg-row " + (out ? "out" : "in");

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (m.type === "sticker" ? " sticker-bubble" : "");

  if (m.type === "text") {
    bubble.innerHTML = `${escapeHtml(m.content)}<span class="time">${formatTime(m.created_at)}</span>`;
  } else if (m.type === "image") {
    bubble.innerHTML = `<img class="msg-img" src="${m.file_url}" alt="gambar" /><span class="time">${formatTime(m.created_at)}</span>`;
  } else if (m.type === "sticker") {
    bubble.innerHTML = `<img src="${m.file_url}" alt="stiker" />`;
  } else if (m.type === "file") {
    bubble.innerHTML = `<a class="file-card" href="${m.file_url}" target="_blank" rel="noopener">
        <div class="file-icon">📄</div>
        <div class="file-meta"><strong>${escapeHtml(m.file_name || "Dokumen")}</strong><span>${fileSizeLabel(m.file_size)}</span></div>
      </a><span class="time">${formatTime(m.created_at)}</span>`;
  }
  row.appendChild(bubble);
  return row;
}

function listenToChat(chatId) {
  if (state.messagesChannel) {
    supabase.removeChannel(state.messagesChannel);
    state.messagesChannel = null;
  }
  state.messagesChannel = supabase
    .channel("chat-" + chatId)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, (payload) => {
      const container = $("#messagesContainer");
      const lastDivider = container.querySelector(".day-divider:last-of-type");
      const today = formatDay(payload.new.created_at);
      if (!lastDivider || lastDivider.textContent !== today) {
        const div = document.createElement("div");
        div.className = "day-divider";
        div.textContent = today;
        container.appendChild(div);
      }
      container.appendChild(renderMessageNode(payload.new));
      container.scrollTop = container.scrollHeight;
      updateChatPreview(chatId, payload.new);
    })
    .subscribe();
}

function updateChatPreview(chatId, msg) {
  const row = state.chats.find((c) => c.chatId === chatId);
  if (row) {
    row.lastMessage = msg;
    state.chats.sort((a, b) => {
      const ta = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
      const tb = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
      return tb - ta;
    });
    renderChatList($("#searchInput").value);
  } else {
    loadChats();
  }
}

/* Inbox global: agar chat baru dari orang lain juga masuk daftar */
function subscribeToInbox() {
  supabase
    .channel("inbox-" + state.me.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_participants", filter: `profile_id=eq.${state.me.id}` }, () => {
      loadChats();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      if (payload.new.chat_id !== state.activeChatId) {
        const known = state.chats.some((c) => c.chatId === payload.new.chat_id);
        if (known) updateChatPreview(payload.new.chat_id, payload.new);
      }
    })
    .subscribe();
}

function subscribeToPresence() {
  window.addEventListener("beforeunload", () => {
    navigator.sendBeacon &&
      supabase.from("profiles").update({ is_online: false, last_seen: new Date().toISOString() }).eq("id", state.me.id);
  });
}

/* =========================================================
   KIRIM PESAN
========================================================= */
async function sendTextMessage() {
  const input = $("#messageInput");
  const text = input.value.trim();
  if (!text || !state.activeChatId) return;
  input.value = "";
  const { error } = await supabase.from("messages").insert({
    chat_id: state.activeChatId,
    sender_id: state.me.id,
    type: "text",
    content: text,
  });
  if (error) { console.error(error); toast("Gagal mengirim pesan"); }
}

async function uploadAndSend(file, kind) {
  if (!file || !state.activeChatId) return;
  toast(kind === "image" ? "Mengunggah gambar..." : "Mengunggah file...");
  const path = `${state.activeChatId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: upErr } = await supabase.storage.from(BUCKET_MEDIA).upload(path, file);
  if (upErr) { console.error(upErr); toast("Gagal mengunggah file"); return; }
  const { data: pub } = supabase.storage.from(BUCKET_MEDIA).getPublicUrl(path);

  const { error } = await supabase.from("messages").insert({
    chat_id: state.activeChatId,
    sender_id: state.me.id,
    type: kind,
    file_url: pub.publicUrl,
    file_name: file.name,
    file_size: file.size,
  });
  if (error) { console.error(error); toast("Gagal mengirim pesan"); }
}

async function sendSticker(stickerUrl) {
  if (!state.activeChatId) return;
  const { error } = await supabase.from("messages").insert({
    chat_id: state.activeChatId,
    sender_id: state.me.id,
    type: "sticker",
    file_url: stickerUrl,
  });
  if (error) console.error(error);
}

/* =========================================================
   STIKER: daftar & pembuat stiker (canvas crop)
========================================================= */
async function loadMyStickers() {
  const { data, error } = await supabase.from("stickers").select("*").eq("owner_id", state.me.id).order("created_at", { ascending: false });
  if (error) { console.error(error); return; }
  state.stickers = data || [];
  renderStickerGrid();
}

function renderStickerGrid() {
  const grid = $("#stickerGrid");
  grid.innerHTML = "";
  if (!state.stickers.length) {
    grid.innerHTML = `<div class="empty">Belum ada stiker. Klik "Buat baru" untuk membuat stikermu sendiri.</div>`;
    return;
  }
  state.stickers.forEach((s) => {
    const img = document.createElement("img");
    img.src = s.image_url;
    img.alt = "stiker";
    img.addEventListener("click", () => sendSticker(s.image_url));
    grid.appendChild(img);
  });
}

/* --- Pembuat stiker sederhana dengan canvas (crop persegi + zoom) --- */
const stickerMaker = {
  img: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

function initStickerMaker() {
  const canvas = $("#stickerCanvas");
  const ctx = canvas.getContext("2d");

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!stickerMaker.img) return;
    const { img, zoom, offsetX, offsetY } = stickerMaker;
    const scale = Math.max(canvas.width / img.width, canvas.height / img.height) * zoom;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (canvas.width - w) / 2 + offsetX;
    const y = (canvas.height - h) / 2 + offsetY;
    ctx.drawImage(img, x, y, w, h);
  }
  stickerMaker.draw = draw;

  $("#stickerFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        stickerMaker.img = img;
        stickerMaker.zoom = 1;
        stickerMaker.offsetX = 0;
        stickerMaker.offsetY = 0;
        $("#stickerZoom").value = 1;
        $("#stickerControls").classList.remove("hidden");
        draw();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  $("#stickerZoom").addEventListener("input", (e) => {
    stickerMaker.zoom = parseFloat(e.target.value);
    draw();
  });

  canvas.addEventListener("pointerdown", (e) => {
    stickerMaker.dragging = true;
    stickerMaker.lastX = e.clientX;
    stickerMaker.lastY = e.clientY;
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("pointerup", () => { stickerMaker.dragging = false; canvas.style.cursor = "grab"; });
  window.addEventListener("pointermove", (e) => {
    if (!stickerMaker.dragging) return;
    stickerMaker.offsetX += e.clientX - stickerMaker.lastX;
    stickerMaker.offsetY += e.clientY - stickerMaker.lastY;
    stickerMaker.lastX = e.clientX;
    stickerMaker.lastY = e.clientY;
    draw();
  });

  $("#saveStickerBtn").addEventListener("click", async () => {
    if (!stickerMaker.img) return;
    $("#saveStickerBtn").disabled = true;
    $("#saveStickerBtn").textContent = "Menyimpan...";
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.92));
      const path = `${state.me.id}/${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage.from(BUCKET_STICKERS).upload(path, blob, { contentType: "image/webp" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(BUCKET_STICKERS).getPublicUrl(path);
      const { error } = await supabase.from("stickers").insert({ owner_id: state.me.id, image_url: pub.publicUrl });
      if (error) throw error;
      toast("Stiker tersimpan!");
      closeModal("stickerMakerModal");
      resetStickerMaker();
      await loadMyStickers();
      $("#stickerTray").classList.remove("hidden");
    } catch (err) {
      console.error(err);
      toast("Gagal menyimpan stiker");
    } finally {
      $("#saveStickerBtn").disabled = false;
      $("#saveStickerBtn").textContent = "Simpan Stiker";
    }
  });
}

function resetStickerMaker() {
  stickerMaker.img = null;
  stickerMaker.zoom = 1;
  stickerMaker.offsetX = 0;
  stickerMaker.offsetY = 0;
  $("#stickerFileInput").value = "";
  $("#stickerControls").classList.add("hidden");
  const canvas = $("#stickerCanvas");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

/* =========================================================
   PEMBARUAN (status ala story, teks 24 jam)
========================================================= */
async function loadStatuses() {
  fillAvatarNode($("#myStatusAvatar"), state.me);
  const { data, error } = await supabase
    .from("statuses")
    .select("*, profiles(*)")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return; }

  const feed = $("#statusFeed");
  feed.innerHTML = "";
  const others = data.filter((s) => s.owner_id !== state.me.id);
  if (!others.length) {
    feed.innerHTML = `<div class="empty-inline"><p>Belum ada pembaruan dari pengguna lain.</p></div>`;
    return;
  }
  others.forEach((s) => {
    const div = document.createElement("div");
    div.className = "chat-row";
    const avatar = document.createElement("div");
    avatar.className = "avatar-fallback";
    fillAvatarNode(avatar, s.profiles);
    div.innerHTML = `<div class="row-text"><strong>${escapeHtml(s.profiles?.username || "Pengguna")}</strong><span>${escapeHtml(s.content || "Membagikan foto")}</span></div>`;
    div.prepend(avatar);
    feed.appendChild(div);
  });
}

async function postStatus() {
  const text = $("#statusText").value.trim();
  if (!text) return;
  const { error } = await supabase.from("statuses").insert({ owner_id: state.me.id, type: "text", content: text });
  if (error) { console.error(error); toast("Gagal membagikan pembaruan"); return; }
  $("#statusText").value = "";
  closeModal("statusComposerModal");
  toast("Pembaruan dibagikan!");
  loadStatuses();
}

/* =========================================================
   PENGATURAN / PROFIL
========================================================= */
function openSettings() {
  fillAvatarNode($("#settingsAvatar"), state.me);
  $("#settingsUsername").value = state.me.username;
  $("#settingsAbout").value = state.me.about || "";
  openModal("settingsModal");
}

async function saveSettings() {
  const about = $("#settingsAbout").value.trim();
  const { data, error } = await supabase.from("profiles").update({ about }).eq("id", state.me.id).select().single();
  if (error) { console.error(error); toast("Gagal menyimpan"); return; }
  state.me = data;
  closeModal("settingsModal");
  toast("Profil diperbarui");
}

async function changeAvatar(file) {
  if (!file) return;
  toast("Mengunggah foto profil...");
  const path = `avatars/${state.me.id}-${Date.now()}.${file.name.split(".").pop()}`;
  const { error: upErr } = await supabase.storage.from(BUCKET_MEDIA).upload(path, file, { upsert: true });
  if (upErr) { console.error(upErr); toast("Gagal mengunggah foto"); return; }
  const { data: pub } = supabase.storage.from(BUCKET_MEDIA).getPublicUrl(path);
  const { data, error } = await supabase.from("profiles").update({ avatar_url: pub.publicUrl }).eq("id", state.me.id).select().single();
  if (error) { console.error(error); return; }
  state.me = data;
  fillAvatarNode($("#settingsAvatar"), state.me);
  fillAvatarNode($("#myAvatarFallback"), state.me);
  $("#myAvatarImg").src = state.me.avatar_url;
  $("#myAvatarImg").style.display = "block";
  toast("Foto profil diperbarui");
}

/* =========================================================
   EVENT WIRING
========================================================= */
function wireEvents() {
  $("#startBtn").addEventListener("click", handleStart);
  $("#usernameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") handleStart(); });

  $$(".nav-icon[data-tab]").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  $("#searchInput").addEventListener("input", (e) => {
    if (state.activeTab === "chats") renderChatList(e.target.value);
  });

  $("#composeBtn").addEventListener("click", () => { $("#newChatSearch").value = ""; $("#newChatResults").innerHTML = ""; openModal("newChatModal"); $("#newChatSearch").focus(); });
  $("#newChatSearch").addEventListener("input", (e) => searchUsers(e.target.value));

  $("#menuDotsBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#dotsMenu").classList.toggle("hidden"); });
  document.addEventListener("click", (e) => {
    if (!$("#dotsMenu").contains(e.target) && e.target.id !== "menuDotsBtn") $("#dotsMenu").classList.add("hidden");
    if (!$("#attachMenu").contains(e.target) && e.target.id !== "attachBtn") $("#attachMenu").classList.add("hidden");
  });
  $$(".dropdown-menu button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#dotsMenu").classList.add("hidden");
      const action = btn.dataset.action;
      if (action === "settings") openSettings();
      if (action === "new-chat") $("#composeBtn").click();
      if (action === "theme") toggleTheme();
      if (action === "logout") logout();
    });
  });

  $("#myAvatarBtn").addEventListener("click", openSettings);
  $("#myStatusRow").addEventListener("click", () => openModal("statusComposerModal"));
  $("#postStatusBtn").addEventListener("click", postStatus);

  $$(".modal-close").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.close)));
  $$(".modal-overlay").forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.add("hidden"); }));

  $("#sendBtn").addEventListener("click", sendTextMessage);
  $("#messageInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendTextMessage(); });

  $("#attachBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#attachMenu").classList.toggle("hidden"); });
  $$("#attachMenu button[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#attachMenu").classList.add("hidden");
      const type = btn.dataset.type;
      if (type === "image") $("#imageInput").click();
      if (type === "file") $("#fileInput").click();
      if (type === "sticker") { resetStickerMaker(); openModal("stickerMakerModal"); }
    });
  });
  $("#imageInput").addEventListener("change", (e) => { uploadAndSend(e.target.files[0], "image"); e.target.value = ""; });
  $("#fileInput").addEventListener("change", (e) => { uploadAndSend(e.target.files[0], "file"); e.target.value = ""; });

  $("#stickerToggleBtn").addEventListener("click", () => $("#stickerTray").classList.toggle("hidden"));
  $("#makeStickerBtn").addEventListener("click", () => { resetStickerMaker(); openModal("stickerMakerModal"); });

  $("#avatarInput").addEventListener("change", (e) => changeAvatar(e.target.files[0]));
  $("#saveSettingsBtn").addEventListener("click", saveSettings);

  initStickerMaker();
}

wireEvents();
init();
