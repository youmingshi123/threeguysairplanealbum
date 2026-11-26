"use strict";
const $ = id => document.getElementById(id);
const field = (form, name) => form.elements.namedItem(name);
const norm = s => s.trim().toUpperCase();
let session, aircrafts = [], version = "", imgOrigin = "", mode = "team", selected;
let busy = false, noticeTimer, uploaded = {};
try { session = JSON.parse(sessionStorage.getItem("aircraftSession")); } catch {}

function note(message, persistent = false) {
  clearTimeout(noticeTimer);
  const n = $("notice");
  n.textContent = message;
  n.showPopover();
  if (!persistent) noticeTimer = setTimeout(() => n.hidePopover(), 5000);
}

function signOut() {
  sessionStorage.removeItem("aircraftSession");
  session = null; aircrafts = []; version = ""; selected = null; mode = "team"; uploaded = {};
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  $("grid").replaceChildren(); $("photos").replaceChildren(); $("search").value = "";
  $("app").hidden = true; $("gate").hidden = false;
  $("loginForm").reset(); field($("loginForm"), "username").focus();
}

async function api(path, data, extra = {}) {
  const headers = { ...extra };
  if (session) headers.Authorization = "Bearer " + session.token;
  if (data !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch("/api/" + path, { method: data === undefined ? "GET" : "POST",
    headers, body: JSON.stringify(data), cache: "no-store" });
  if (response.status === 401 && path !== "login") signOut();
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "请求失败"), { status: response.status });
  return { result, headers: response.headers };
}

async function run(job) {
  if (busy) return;
  busy = true;
  try { await job(); } catch (e) { note(e.message || "操作失败，请重试"); }
  finally { busy = false; }
}

function bindForm(id, job) {
  const f = $(id);
  f.onsubmit = event => {
    event.preventDefault();
    run(async () => {
      f.inert = true;
      try { await job(f); } finally { f.inert = false; }
    });
  };
}

function node(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function picture(url, label) {
  const img = node("img");
  img.src = url; img.alt = label; img.loading = "lazy";
  return img;
}
function render() {
  const mine = mode === "mine", query = $("search").value.trim().toLowerCase();
  $("title").textContent = mine ? "我的图库" : "团队图库";
  $("who").textContent = session.username;
  for (const id of ["team", "mine"]) $(id).setAttribute("aria-pressed", String(id === mode));
  const visible = aircrafts.filter(a => (!mine || a.photos.some(p => p.uploader === session.username)) &&
    [a.model, a.reg, a.airline, a.livery].some(s => s.toLowerCase().includes(query)));
  $("count").textContent = visible.length ? visible.length + " 架飞机" : query ? "没有匹配的飞机" : "暂无飞机";
  $("grid").replaceChildren(...visible.map(a => {
    const card = node("button", undefined, "card");
    card.append(a.photos.length ? picture(a.photos[0].url, a.reg) : node("span", "暂无照片", "cover"),
      node("strong", a.reg + " · " + a.model), node("span", [a.airline, a.livery].filter(Boolean).join(" · "), "info"));
    card.onclick = () => { if (!busy) { selected = a.id; renderAlbum(); $("album").showModal(); } };
    return card;
  }));
}
function active() { return aircrafts.find(a => a.id === selected); }
function action(label, job, disabled = false) {
  const b = node("button", label); b.disabled = disabled; b.onclick = () => run(job); return b;
}
function renderAlbum() {
  const a = active();
  if (!a) { $("album").close(); return; }
  $("albumTitle").textContent = a.reg;
  $("summary").textContent = [a.model, a.airline, a.livery].filter(Boolean).join(" · ");
  $("delPlane").disabled = a.photos.some(p => p.uploader !== session.username);
  $("delPlane").title = $("delPlane").disabled ? "含其他成员的照片" : "";
  $("photos").replaceChildren(...a.photos.map((p, i) => {
    const fig = node("figure"), caption = node("figcaption", p.uploader + " · " + p.date);
    caption.append(action("下载原图", () => download(p, a.reg)), action("删除", async () => {
      if (confirm("从图库删除这张照片？")) await save(draft => draft.find(x => x.id === a.id).photos.splice(i, 1));
    }, p.uploader !== session.username));
    fig.append(picture(p.url, a.reg + "，" + p.date), caption); return fig;
  }));
  if (!a.photos.length) $("photos").textContent = "暂无照片";
}
async function refresh() {
  const r = await api("aircrafts");
  aircrafts = r.result; version = r.headers.get("X-Gallery-Version");
  imgOrigin = r.headers.get("X-Image-Origin"); render();
  if ($("album").open) renderAlbum();
  if ($("add").open) matchReg();
}
async function save(change) {
  const before = aircrafts, draft = structuredClone(before);
  change(draft);
  draft.sort((a, b) => a.reg.localeCompare(b.reg));
  aircrafts = draft;
  try {
    const r = await api("aircrafts", draft, { "X-Gallery-Version": version });
    version = r.headers.get("X-Gallery-Version");
  } catch (err) {
    if (session) {
      aircrafts = before;
      if (err.status === 409 || !err.status) {
        if ($("edit").open) $("edit").close();
        await refresh();
      }
    }
    throw err;
  }
  render(); if ($("album").open) renderAlbum();
}
async function enter() {
  await refresh(); $("gate").hidden = true; $("app").hidden = false;
}
bindForm("loginForm", async f => {
  const { result } = await api("login", Object.fromEntries(new FormData(f)));
  session = { username: result.username, token: result.token };
  sessionStorage.setItem("aircraftSession", JSON.stringify(session));
  field(f, "password").value = ""; await enter();
});
$("logout").onclick = () => run(async () => { await api("logout", {}); signOut(); });
$("settings").onclick = () => {
  const f = $("accountForm"); f.reset(); field(f, "newUsername").value = session.username; $("account").showModal();
};
bindForm("accountForm", async f => {
  await api("change-password", { ...Object.fromEntries(new FormData(f)), oldUsername: session.username });
  f.reset(); signOut(); note("账号已更新，请重新登录");
});
function switchGallery(next) {
  if (mode === next) return;
  mode = next;
  render();

  const offset = next === "mine" ? 12 : -12;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const id of ["title", "count", "grid"]) {
    const element = $(id);
    for (const animation of element.getAnimations()) {
      if (animation.id === "gallery-switch") animation.cancel();
    }
    if (!reducedMotion) {
      element.animate([
        { opacity: 0.25, transform: `translateX(${offset}px)` },
        { opacity: 1, transform: "translateX(0)" }
      ], { id: "gallery-switch", duration: 220, easing: "ease-out" });
    }
  }
}
for (const id of ["team", "mine"]) $(id).onclick = () => switchGallery(id);
$("search").oninput = render;
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { if (!busy) b.closest("dialog").close(); });
document.querySelectorAll("dialog").forEach(d => d.oncancel = e => { if (busy) e.preventDefault(); });
function matchReg() {
  const reg = norm(field($("addForm"), "reg").value), a = aircrafts.find(x => norm(x.reg) === reg);
  $("details").hidden = $("details").disabled = !!a;
  $("match").textContent = a ? "已存在 · " + a.model + "，将追加照片" : "";
  return a;
}
const addForm = $("addForm");
field(addForm, "reg").oninput = matchReg;
document.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
  if (busy) return;
  addForm.reset(); uploaded = {};
  const now = new Date();
  field(addForm, "date").value = new Date(+now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  matchReg(); $("add").showModal();
});
async function preview(file) {
  const bmp = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * ratio)); c.height = Math.max(1, Math.round(bmp.height * ratio));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error("压缩失败")),
      "image/jpeg", 0.82));
  } finally { bmp.close(); }
}
async function upload(blob, name) {
  const form = new FormData();
  form.append("file", blob, name);

  const response = await fetch("/api/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + session.token
    },
    body: form
  });

  if (response.status === 401) {
    signOut();
    throw new Error("登录已过期，请重新登录");
  }

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "上传失败");
  }

  return result.url;
}
bindForm("addForm", async f => {
  const values = Object.fromEntries(new FormData(f)), file = values.file, reg = norm(values.reg);
  const found = matchReg();
  if (!reg || (!found && (!values.model?.trim() || !values.airline?.trim()))) throw new Error("请填写飞机信息");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPG、PNG 或 WebP");
  if (uploaded.file !== file) uploaded = { file };
  note("正在上传照片…", true);
  uploaded.url ||= await upload(await preview(file), "preview.jpg");
  uploaded.originalUrl ||= await upload(file, file.name);
  const photo = { url: uploaded.url, originalUrl: uploaded.originalUrl, uploader: session.username, date: values.date };
  await save(draft => {
    let a = draft.find(x => norm(x.reg) === reg);
    if (!a) {
      a = { id: crypto.randomUUID(), reg, model: values.model.trim(), airline: values.airline.trim(),
        livery: values.livery.trim(), photos: [] };
      draft.push(a);
    }
    if (!a.photos.some(p => p.url === photo.url && p.uploader === photo.uploader && p.date === photo.date))
      a.photos.push(photo);
  });
  uploaded = {}; $("add").close(); note("已保存");
});
async function download(p, reg) {
  const url = p.originalUrl || p.url;
  const r = await fetch(url, { credentials: "omit" });
  if (!r.ok) throw new Error("下载失败（" + r.status + "）");
  const blob = await r.blob(), href = URL.createObjectURL(blob);
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[blob.type] ||
    new URL(url).pathname.split("/").pop().match(/\.(\w{1,5})$/)?.[1] || "jpg";
  const link = node("a"); link.href = href; link.download = reg + "-" + p.date + "." + ext;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 30000);
}
$("editPlane").onclick = () => {
  if (busy) return;
  const f = $("editForm");
  for (const key of ["reg", "model", "airline", "livery"]) field(f, key).value = active()[key];
  $("edit").showModal();
};
bindForm("editForm", async f => {
  const info = Object.fromEntries(new FormData(f));
  for (const key of Object.keys(info)) info[key] = info[key].trim();
  info.reg = norm(info.reg);
  if (aircrafts.some(a => a.id !== selected && norm(a.reg) === info.reg)) throw new Error("该注册号已存在");
  await save(draft => Object.assign(draft.find(a => a.id === selected), info)); $("edit").close();
});
$("delPlane").onclick = () => run(async () => {
  if (confirm("删除 " + active().reg + " 及其图库照片记录？"))
    await save(draft => draft.splice(draft.findIndex(a => a.id === selected), 1));
});
if (session?.token) run(enter);
