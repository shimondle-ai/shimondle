import "./styles.css";
import { plainText, renderMarkdown } from "./markdown";
import { listModels, ping, stopChat, streamChat, type ModelInfo } from "./ollama";
import {
  loadConversations,
  loadSettings,
  saveConversations,
  saveSettings,
  uid,
  type Conversation,
  type Message,
} from "./store";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

const state = {
  convos: loadConversations(),
  activeId: null as string | null,
  settings: loadSettings(),
  models: [] as ModelInfo[],
  online: false,
  streaming: false,
  streamNode: null as HTMLElement | null,
  requestId: null as string | null,
};

const ICON = {
  spark: '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M8 1.4l1.5 4.1L13.6 7 9.5 8.5 8 12.6 6.5 8.5 2.4 7l4.1-1.5L8 1.4z"/></svg>',
  chat: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 9.2a2 2 0 0 1-2 2H5.6L3 13.4v-9a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2v4.8z"/></svg>',
  code: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.6 4.2 2.2 8l3.4 3.8M10.4 4.2 13.8 8l-3.4 3.8"/></svg>',
  write: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11.2 2.6l2.2 2.2-7.7 7.7-2.9.7.7-2.9 7.7-7.7z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.8 4.4h10.4M6.4 4.4V3.1h3.2v1.3M4.2 4.4l.6 8.2h6.4l.6-8.2"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.4" y="5.4" width="7.4" height="7.4" rx="1.6"/><path d="M10.6 3.2H4.4a1.6 1.6 0 0 0-1.6 1.6v6.2"/></svg>',
  redo: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.4a5.2 5.2 0 1 0 .6 3.4"/><path d="M13.2 2.8v3.8H9.4"/></svg>',
};

/* ---------------- boot ---------------- */

function markSrc() {
  return state.settings.theme === "dark" ? "/mark-dark.png" : "/mark-light.png";
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  const mark = $("#brand-mark") as HTMLImageElement;
  mark.src = markSrc();
}

function activeConvo(): Conversation | undefined {
  return state.convos.find((c) => c.id === state.activeId);
}

function persist() {
  state.convos.sort((a, b) => b.updatedAt - a.updatedAt);
  saveConversations(state.convos);
}

function setStatus(online: boolean) {
  state.online = online;
  const el = $("#status");
  el.classList.toggle("on", online);
  el.classList.toggle("off", !online);
  $(".status-text", el).textContent = online
    ? `Ollama · ${state.models.length} model${state.models.length === 1 ? "" : "s"}`
    : "Ollama offline";
}

async function refreshModels(silent = true) {
  try {
    state.models = await listModels(state.settings.baseUrl);
    if (!state.settings.model && state.models.length) {
      state.settings.model = state.models[0].name;
      saveSettings(state.settings);
    }
    setStatus(true);
  } catch {
    state.models = [];
    setStatus(false);
    if (!silent) flashStatus("Can't reach Ollama at " + state.settings.baseUrl);
  }
  renderSidebar();
  renderModelChip();
}

function flashStatus(text: string) {
  const el = $(".status-text");
  const prev = el.textContent;
  el.textContent = text;
  setTimeout(() => { if (el.textContent === text) el.textContent = prev; }, 2600);
}

/* ---------------- sidebar ---------------- */

function formatSize(bytes: number) {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

function renderSidebar() {
  const list = $("#convo-list");
  if (!state.convos.length) {
    list.innerHTML = `<div class="menu-empty" style="padding:10px 10px 0;color:var(--faint)">No chats yet.</div>`;
  } else {
    list.innerHTML = state.convos
      .map(
        (c) => `<button class="convo ${c.id === state.activeId ? "active" : ""}" data-id="${c.id}">
          <span>${escapeHtml(c.title || "New chat")}</span>
          <span class="del" data-del="${c.id}" title="Delete">${ICON.trash}</span>
        </button>`,
      )
      .join("");
  }
  const model = state.models.find((m) => m.name === state.settings.model);
  $("#model-name").textContent = model ? model.name : state.settings.model || "No model";
  $("#model-sub").textContent = model
    ? [model.params, model.quant, formatSize(model.size)].filter(Boolean).join(" · ")
    : state.online ? "Pick a model" : "Connect Ollama";
}

function renderModelChip() {
  $("#chip-model").textContent = state.settings.model || "no model";
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------------- main ---------------- */

const SUGGESTIONS = [
  { icon: ICON.spark, label: "Explain a tricky idea", prompt: "Explain how transformer attention works, in plain language." },
  { icon: ICON.code, label: "Debug this error", prompt: "I'll paste an error. Explain what it means and how to fix it.\n\n" },
  { icon: ICON.write, label: "Draft a reply", prompt: "Help me write a short, friendly reply to this message:\n\n" },
  { icon: ICON.chat, label: "Think it through", prompt: "Talk me through the tradeoffs of running a 7B model versus a 3B model locally." },
];

function renderMain() {
  const convo = activeConvo();
  $("#tb-title").textContent = convo ? convo.title || "New chat" : "New chat";
  const t = $("#transcript");

  if (!convo || convo.messages.length === 0) {
    t.innerHTML = `<div class="empty">
      <div class="hero"><img src="${markSrc()}" alt="Shimondle" /></div>
      <h1>shimondle</h1>
      <p class="tagline">Your models, your machine. A quiet little front end for Ollama. No accounts, no cloud, no telemetry.</p>
      <div class="suggest">
        ${SUGGESTIONS.map((s, i) => `<button data-suggest="${i}">${s.icon}<span>${s.label}</span></button>`).join("")}
      </div>
    </div>`;
  } else {
    t.innerHTML = `<div class="thread">${convo.messages.map(messageHtml).join("")}</div>`;
  }
}

function messageHtml(m: Message): string {
  if (m.role === "user") {
    return `<div class="msg user" data-mid="${m.id}"><div class="bubble">${escapeHtml(m.content)}</div></div>`;
  }
  const isLast = activeConvo()?.messages.at(-1)?.id === m.id;
  return `<div class="msg assistant" data-mid="${m.id}">
    <img class="avatar" src="${markSrc()}" alt="" />
    <div class="bodywrap" style="flex:1;min-width:0">
      <div class="body">${renderMarkdown(m.content)}${m.error ? `<div class="error-line">${escapeHtml(m.error)}</div>` : ""}</div>
      ${m.content || m.error ? `<div class="msg-tools">
        <button class="tool" data-copy-msg="${m.id}">${ICON.copy} Copy</button>
        ${isLast ? `<button class="tool" data-regen="${m.id}">${ICON.redo} Regenerate</button>` : ""}
      </div>` : ""}
    </div>
  </div>`;
}

function scrollToBottom(force = false) {
  const t = $("#transcript");
  const near = t.scrollHeight - t.scrollTop - t.clientHeight < 140;
  if (force || near) t.scrollTop = t.scrollHeight;
}

/* ---------------- chat flow ---------------- */

function newChat() {
  const convo: Conversation = { id: uid(), title: "New chat", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  state.convos.unshift(convo);
  state.activeId = convo.id;
  persist();
  renderSidebar();
  renderMain();
  ($("#input") as HTMLTextAreaElement).focus();
}

function selectConvo(id: string) {
  state.activeId = id;
  renderSidebar();
  renderMain();
  scrollToBottom(true);
}

async function send(text?: string) {
  if (state.streaming) return;
  const input = $("#input") as HTMLTextAreaElement;
  const content = (text ?? input.value).trim();
  if (!content) return;

  if (!state.settings.model) {
    openModelMenu($("#model-btn"));
    return;
  }

  if (!activeConvo()) {
    const convo: Conversation = { id: uid(), title: "New chat", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    state.convos.unshift(convo);
    state.activeId = convo.id;
  }
  const convo = activeConvo()!;

  const userMsg: Message = { id: uid(), role: "user", content, ts: Date.now() };
  convo.messages.push(userMsg);
  if (convo.title === "New chat" || !convo.title) convo.title = titleFor(content);
  convo.updatedAt = Date.now();

  input.value = "";
  autoGrow(input);
  persist();
  renderSidebar();
  renderMain();
  scrollToBottom(true);

  const assistantMsg: Message = {
    id: uid(),
    role: "assistant",
    content: "",
    ts: Date.now(),
    model: state.settings.model,
  };
  convo.messages.push(assistantMsg);
  renderMain();
  scrollToBottom(true);

  const node = document.querySelector(`[data-mid="${assistantMsg.id}"] .body`) as HTMLElement | null;
  state.streamNode = node;
  state.streaming = true;
  document.body.classList.add("sending");
  updateSendState();

  const history = convo.messages
    .filter((m) => m.id !== assistantMsg.id && !m.error)
    .map((m) => ({ role: m.role, content: m.content }));

  let pending = "";
  let frame = 0;
  const paint = () => {
    frame = 0;
    if (state.streamNode) state.streamNode.innerHTML = renderMarkdown(pending) + '<span class="caret"></span>';
    scrollToBottom();
  };

  let stopped = false;
  state.requestId = streamChat(
    {
      baseUrl: state.settings.baseUrl,
      model: state.settings.model,
      system: state.settings.system,
      messages: history,
      temperature: state.settings.temperature,
      numCtx: state.settings.numCtx,
    },
    {
      onDelta: (chunk) => {
        pending += chunk;
        if (!frame) frame = requestAnimationFrame(paint);
      },
      onDone: ({ stopped: wasStopped }) => {
        stopped = wasStopped;
        assistantMsg.content = pending;
        state.streaming = false;
        state.streamNode = null;
        state.requestId = null;
        document.body.classList.remove("sending");
        updateSendState();
        if (stopped && !pending.trim()) convo.messages = convo.messages.filter((m) => m.id !== assistantMsg.id);
        convo.updatedAt = Date.now();
        persist();
        renderSidebar();
        renderMain();
        scrollToBottom();
      },
      onError: (message) => {
        assistantMsg.content = pending;
        assistantMsg.error = message;
        state.streaming = false;
        state.streamNode = null;
        state.requestId = null;
        document.body.classList.remove("sending");
        updateSendState();
        persist();
        renderMain();
        scrollToBottom();
      },
    },
  );
  void stopped;
}

function titleFor(content: string) {
  const clean = plainText(content).replace(/\s+/g, " ").trim();
  return clean.length > 46 ? clean.slice(0, 46).replace(/[,.;:\s]+$/, "") + "…" : clean || "New chat";
}

function regenerate(id: string) {
  const convo = activeConvo();
  if (!convo || state.streaming) return;
  const idx = convo.messages.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const priorUser = [...convo.messages.slice(0, idx)].reverse().find((m) => m.role === "user");
  if (!priorUser) return;
  convo.messages = convo.messages.slice(0, idx);
  renderMain();
  send(priorUser.content);
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch { /* give up quietly */ }
  ta.remove();
}

function updateSendState() {
  const btn = $("#send") as HTMLButtonElement;
  const input = $("#input") as HTMLTextAreaElement;
  if (state.streaming) { btn.disabled = false; return; }
  btn.disabled = !input.value.trim();
}

/* ---------------- composer ---------------- */

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 210) + "px";
  updateSendState();
}

/* ---------------- model menu ---------------- */

function closePopovers() {
  $("#popover-root").innerHTML = "";
}

function openModelMenu(anchor: HTMLElement) {
  const root = $("#popover-root");
  if (root.innerHTML) { closePopovers(); return; }
  const rect = anchor.getBoundingClientRect();
  const items = state.models.length
    ? state.models
        .map(
          (m) => `<button class="menu-item ${m.name === state.settings.model ? "active" : ""}" data-model="${escapeHtml(m.name)}">
            <span class="mi-main"><span class="mi-name">${escapeHtml(m.name)}</span>
            <span class="mi-sub">${[m.params, m.quant, formatSize(m.size)].filter(Boolean).join(" · ") || "local"}</span></span>
            ${m.name === state.settings.model ? '<span class="mi-check">✓</span>' : ""}
          </button>`,
        )
        .join("")
    : `<div class="menu-empty">No models found. Pull one first:<br><code>ollama pull llama3.2</code><br><br>Then reopen this menu.</div>`;

  root.innerHTML = `<div class="menu" style="left:${Math.min(rect.left, window.innerWidth - 340)}px; bottom:${window.innerHeight - rect.top + 8}px">${items}</div>`;
  root.querySelectorAll<HTMLElement>("[data-model]").forEach((el) =>
    el.addEventListener("click", () => {
      state.settings.model = el.dataset.model!;
      saveSettings(state.settings);
      closePopovers();
      renderSidebar();
      renderModelChip();
      updateSendState();
    }),
  );
}

/* ---------------- settings ---------------- */

function openSettings() {
  const root = $("#modal-root");
  const s = state.settings;
  root.innerHTML = `<div class="backdrop">
    <div class="sheet">
      <h2>Settings</h2>
      <p class="sub">Everything stays on this machine.</p>

      <div class="field">
        <label>Ollama address</label>
        <input id="set-url" type="text" spellcheck="false" value="${escapeHtml(s.baseUrl)}" />
        <div class="help">Shimondle talks to the Ollama server that is already running. Default is <code>http://127.0.0.1:11434</code>.</div>
      </div>

      <div class="field">
        <label>System prompt</label>
        <textarea id="set-system">${escapeHtml(s.system)}</textarea>
      </div>

      <div class="row2">
        <div class="field">
          <label>Temperature <span id="temp-val" style="color:var(--accent);text-transform:none;letter-spacing:0">${s.temperature.toFixed(1)}</span></label>
          <input id="set-temp" type="range" min="0" max="1.5" step="0.1" value="${s.temperature}" />
          <div class="help">Lower is steadier, higher is more surprising.</div>
        </div>
        <div class="field">
          <label>Context window</label>
          <select id="set-ctx">
            ${[2048, 4096, 8192, 16384, 32768].map((n) => `<option value="${n}" ${n === s.numCtx ? "selected" : ""}>${n / 1024}k tokens</option>`).join("")}
          </select>
          <div class="help">How much conversation the model can see.</div>
        </div>
      </div>

      <div class="field">
        <label>Appearance</label>
        <div class="seg" id="set-theme">
          <button data-theme="dark" class="${s.theme === "dark" ? "on" : ""}">Dark</button>
          <button data-theme="light" class="${s.theme === "light" ? "on" : ""}">Light</button>
        </div>
      </div>

      <div class="sheet-foot">
        <button class="btn" id="test-conn">Test connection</button>
        <span id="test-result" style="font-size:12px;color:var(--muted)"></span>
        <span class="spacer"></span>
        <button class="btn ghost" id="cancel-settings">Cancel</button>
        <button class="btn primary" id="save-settings">Save</button>
      </div>
    </div>
  </div>`;

  const temp = $("#set-temp") as HTMLInputElement;
  temp.addEventListener("input", () => { $("#temp-val").textContent = Number(temp.value).toFixed(1); });

  let theme = s.theme;
  root.querySelectorAll<HTMLElement>("#set-theme button").forEach((b) =>
    b.addEventListener("click", () => {
      theme = b.dataset.theme as "dark" | "light";
      root.querySelectorAll("#set-theme button").forEach((x) => x.classList.toggle("on", x === b));
    }),
  );

  $("#cancel-settings").addEventListener("click", closeModal);
  $(".backdrop", root).addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });

  $("#test-conn").addEventListener("click", async () => {
    const url = ($("#set-url") as HTMLInputElement).value.trim();
    $("#test-result").textContent = "checking…";
    const ok = await ping(url);
    $("#test-result").textContent = ok ? "reachable ✓" : "no response";
    $("#test-result").style.color = ok ? "var(--good)" : "var(--bad)";
  });

  $("#save-settings").addEventListener("click", async () => {
    state.settings = {
      ...state.settings,
      baseUrl: ($("#set-url") as HTMLInputElement).value.trim() || "http://127.0.0.1:11434",
      system: ($("#set-system") as HTMLTextAreaElement).value,
      temperature: Number(($("#set-temp") as HTMLInputElement).value),
      numCtx: Number(($("#set-ctx") as HTMLSelectElement).value),
      theme,
    };
    saveSettings(state.settings);
    applyTheme();
    closeModal();
    renderMain();
    await refreshModels(false);
  });
}

function closeModal() { $("#modal-root").innerHTML = ""; }

/* ---------------- wiring ---------------- */

function bind() {
  $("#new-chat").addEventListener("click", newChat);

  $("#convo-list").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const del = target.closest("[data-del]") as HTMLElement | null;
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del!;
      state.convos = state.convos.filter((c) => c.id !== id);
      if (state.activeId === id) state.activeId = state.convos[0]?.id ?? null;
      persist();
      renderSidebar();
      renderMain();
      return;
    }
    const row = target.closest("[data-id]") as HTMLElement | null;
    if (row) selectConvo(row.dataset.id!);
  });

  const input = $("#input") as HTMLTextAreaElement;
  input.addEventListener("input", () => autoGrow(input));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  });

  $("#send").addEventListener("click", () => {
    if (state.streaming) { void stopChat(); return; }
    void send();
  });

  $("#model-btn").addEventListener("click", (e) => { e.stopPropagation(); openModelMenu($("#model-btn")); });
  $("#composer-model").addEventListener("click", (e) => { e.stopPropagation(); openModelMenu($("#composer-model")); });
  $("#settings-btn").addEventListener("click", openSettings);
  $("#status").addEventListener("click", () => refreshModels(false));

  $("#transcript").addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    const suggest = target.closest("[data-suggest]") as HTMLElement | null;
    if (suggest) {
      const item = SUGGESTIONS[Number(suggest.dataset.suggest)];
      if (item) { input.value = item.prompt; autoGrow(input); input.focus(); }
      return;
    }

    const copyCode = target.closest(".copy-code") as HTMLElement | null;
    if (copyCode) {
      await copyText(decodeURIComponent(copyCode.dataset.copy ?? ""));
      copyCode.textContent = "Copied";
      setTimeout(() => { copyCode.textContent = "Copy"; }, 1200);
      return;
    }

    const copyMsg = target.closest("[data-copy-msg]") as HTMLElement | null;
    if (copyMsg) {
      const msg = activeConvo()?.messages.find((m) => m.id === copyMsg.dataset.copyMsg);
      if (msg) await copyText(msg.content);
      copyMsg.textContent = "Copied";
      setTimeout(() => { copyMsg.innerHTML = `${ICON.copy} Copy`; }, 1200);
      return;
    }

    const regen = target.closest("[data-regen]") as HTMLElement | null;
    if (regen) regenerate(regen.dataset.regen!);
  });

  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".menu")) closePopovers();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePopovers(); closeModal(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newChat(); }
    if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); openSettings(); }
  });
}

function boot() {
  applyTheme();
  state.convos = state.convos.filter((c) => c.messages.length > 0);
  if (state.convos.length) state.activeId = state.convos[0].id;
  bind();
  renderSidebar();
  renderModelChip();
  renderMain();
  updateSendState();
  void refreshModels();
  setInterval(() => { if (!state.streaming) void refreshModels(); }, 20000);
}

boot();
